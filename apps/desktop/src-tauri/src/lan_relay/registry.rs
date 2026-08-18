//! The LAN relay's decision table — the second implementation of `docs/collab-relay-protocol.md`.
//!
//! The first is `apps/collab-server/src/room-connection-registry.ts`, running on Cloudflare. This one
//! runs on a host's own laptop so a workshop, classroom, or air-gapped team can collaborate with no
//! internet at all. They are two deployments of ONE protocol, not two protocols: the rules below are
//! numbered `R1`…`R7` after that spec, the TypeScript suite names its cases the same way, and a drift
//! between them is meant to surface as a failing numbered case rather than as a room that behaves
//! differently depending on who hosts it. Nothing may be added here that the spec does not describe.
//!
//! Like its Worker counterpart this type never decrypts anything and structurally cannot: every frame
//! it handles is either a bare `{"type":"snapshot-request"}` signal or an opaque `{type, iv,
//! ciphertext}` envelope whose `iv`/`ciphertext` it copies verbatim between connections. There is no
//! cipher and no scene-key material in this file — the room's key travels in the URL fragment between
//! humans and never reaches a relay, so the host machine cannot read the board it is hosting either.
//!
//! Kept free of `tokio` and of any socket type, exactly as the Worker version is kept free of Workers
//! runtime types: decisions come back as [`Outbound`] values that the transport in `server.rs` carries
//! out. That is what lets every rule below be tested with no I/O, no runtime, and no fake socket.

use std::collections::HashMap;

use serde_json::{Map, Value};

/// `R3` — hard cap on one inbound frame. Matches the Worker's `MAX_MESSAGE_LENGTH` exactly; see the
/// spec for why it is deliberately tighter than the share-link payload cap.
pub const MAX_MESSAGE_LENGTH: usize = 1024 * 1024;

/// `R1` — the five message kinds a relay will route. The relay has no idea a comment differs from a
/// shape; both are opaque envelopes, which is why adding one cost exactly one string.
const KNOWN_MESSAGE_TYPES: [&str; 5] = ["element-delta", "comment-delta", "presence", "snapshot", "snapshot-request"];

/// `R7` — what a `viewer` connection may send. Absent from this list are `element-delta` and
/// `snapshot`, the two that change what the room's document says.
const VIEWER_ALLOWED_TYPES: [&str; 3] = ["comment-delta", "presence", "snapshot-request"];

/// What a connection is allowed to do, decided once at upgrade time from a signed token (`tokens.rs`)
/// and never from anything the connection says about itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Editor,
    Viewer,
}

/// One thing the transport should do as a result of a decision. Returning these instead of writing to
/// sockets is what keeps this file runtime-free and every rule below directly assertable.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outbound {
    /// Send `frame` to exactly one peer.
    Unicast { peer: String, frame: String },
    /// Send `frame` to every connection except `sender` (`R4`).
    BroadcastExcept { sender: String, frame: String },
    /// Close one connection with a WebSocket close code.
    Close { peer: String, code: u16, reason: &'static str },
}

/// A live connection: its role plus its own rate-limit window.
///
/// The window lives here rather than in a separate keyed map — the deliberate difference from the
/// Worker's `rate-limit.ts`, which needs sweeping and eviction because its keys are client-influenced
/// and outlive any one connection. Here the key IS the connection: the relay assigns the peer id, and
/// the bucket is dropped with the connection, so this cannot grow without bound and needs no sweep.
struct Connection {
    role: Role,
    window_started_at_ms: u64,
    count: u32,
}

pub struct RoomRegistry {
    connections: HashMap<String, Connection>,
    max_requests: u32,
    window_ms: u64,
    /// `R5` — the most recent `snapshot` frame seen, already peer-stamped and ready to unicast.
    /// In-memory only, and deliberately never written to disk: the host's own document is the durable
    /// copy, and a relay that persisted scene bytes would be storing something it cannot read.
    latest_snapshot: Option<String>,
}

impl RoomRegistry {
    pub fn new(max_requests: u32, window_ms: u64) -> Self {
        Self { connections: HashMap::new(), max_requests, window_ms, latest_snapshot: None }
    }

    /// Test-only: the transport tracks its own peers, so nothing in the shipped binary asks the
    /// registry how many there are. Kept because "did that rejected frame also drop the connection?"
    /// is exactly the question several rules need answered.
    #[cfg(test)]
    pub fn connection_count(&self) -> usize {
        self.connections.len()
    }

    /// Registers an accepted connection and announces it to everyone already in the room.
    pub fn join(&mut self, peer_id: &str, role: Role, now_ms: u64) -> Vec<Outbound> {
        self.connections
            .insert(peer_id.to_string(), Connection { role, window_started_at_ms: now_ms, count: 0 });
        vec![Outbound::BroadcastExcept { sender: peer_id.to_string(), frame: signal_frame("peer-joined", peer_id) }]
    }

    /// Deregisters a connection and announces its departure. A peer that was never registered is a
    /// harmless no-op — nobody is told about a departure that did not happen.
    pub fn leave(&mut self, peer_id: &str) -> Vec<Outbound> {
        if self.connections.remove(peer_id).is_none() {
            return Vec::new();
        }
        vec![Outbound::BroadcastExcept { sender: peer_id.to_string(), frame: signal_frame("peer-left", peer_id) }]
    }

    /// Routes one inbound frame. The rule order is part of the spec: `R2` and `R3` are decided before
    /// the frame is even parsed, so an oversized frame from a viewer closes the connection rather than
    /// being quietly dropped by the role gate.
    pub fn handle_message(&mut self, peer_id: &str, raw: &str, now_ms: u64) -> Vec<Outbound> {
        // R2 — over its per-connection budget: closed, not dropped. A client that keeps its socket
        // while being silently ignored has no signal to back off with.
        if !self.allow(peer_id, now_ms) {
            return self.close_if_connected(peer_id, 1013, "rate limit exceeded");
        }
        // R3 — measured in bytes; every field this protocol sends is ASCII, so this agrees with the
        // Worker's UTF-16 code-unit count. Strictly over: a frame exactly at the cap is accepted.
        if raw.len() > MAX_MESSAGE_LENGTH {
            return self.close_if_connected(peer_id, 1009, "message too large");
        }

        // R1 — anything that is not a routable frame is dropped silently and the connection stays
        // open: one malformed frame is far cheaper to ignore than a disconnect/reconnect cycle, and
        // one buggy peer must never cost the room its other members.
        let Some((message_type, object)) = parse_routable(raw) else {
            return Vec::new();
        };
        // R7 — dropped silently too, for the same reason: an out-of-date viewer client is buggy, not
        // hostile, and closing its socket would put it in a reconnect loop instead of leaving it the
        // read-only session it is entitled to.
        if !self.may_send(peer_id, &message_type) {
            return Vec::new();
        }

        if message_type == "snapshot-request" {
            return self.handle_snapshot_request(peer_id);
        }

        // R4 — re-stamped with the relay's own peer id (overwriting any the client supplied) and sent
        // to everyone but the sender. The client's echo guard is a secondary defence; this is the
        // primary one.
        let frame = stamp_peer_id(object, peer_id);
        if message_type == "snapshot" {
            self.latest_snapshot = Some(frame.clone());
        }
        vec![Outbound::BroadcastExcept { sender: peer_id.to_string(), frame }]
    }

    /// `R5` fast path when a snapshot has been seen, `R6` slow path when none has: ask every other
    /// peer to publish one, and whoever answers does so as an ordinary `snapshot` frame. A room with
    /// no other connections leaves the request unanswered, which is correct — the requester is the
    /// first peer, and their own document is the room.
    fn handle_snapshot_request(&self, requester_id: &str) -> Vec<Outbound> {
        match &self.latest_snapshot {
            Some(snapshot) => vec![Outbound::Unicast { peer: requester_id.to_string(), frame: snapshot.clone() }],
            None => vec![Outbound::BroadcastExcept {
                sender: requester_id.to_string(),
                frame: r#"{"type":"snapshot-request"}"#.to_string(),
            }],
        }
    }

    /// `R7`. An unknown peer (one that already left) may send nothing.
    fn may_send(&self, peer_id: &str, message_type: &str) -> bool {
        match self.connections.get(peer_id) {
            None => false,
            Some(connection) => connection.role == Role::Editor || VIEWER_ALLOWED_TYPES.contains(&message_type),
        }
    }

    /// `R2` fixed-window budget. An unknown peer is allowed through here so that the frame falls to
    /// the role gate's "already left" rejection instead of being reported as a rate-limit close.
    fn allow(&mut self, peer_id: &str, now_ms: u64) -> bool {
        let window_ms = self.window_ms;
        let max_requests = self.max_requests;
        let Some(connection) = self.connections.get_mut(peer_id) else {
            return true;
        };
        if now_ms.saturating_sub(connection.window_started_at_ms) >= window_ms {
            connection.window_started_at_ms = now_ms;
            connection.count = 1;
            return true;
        }
        if connection.count >= max_requests {
            return false;
        }
        connection.count += 1;
        true
    }

    fn close_if_connected(&self, peer_id: &str, code: u16, reason: &'static str) -> Vec<Outbound> {
        if !self.connections.contains_key(peer_id) {
            return Vec::new();
        }
        vec![Outbound::Close { peer: peer_id.to_string(), code, reason }]
    }
}

/// `{"type":…,"peerId":…}` — the two frames a relay emits itself and never accepts from a connection.
fn signal_frame(message_type: &str, peer_id: &str) -> String {
    Value::Object(Map::from_iter([
        ("type".to_string(), Value::String(message_type.to_string())),
        ("peerId".to_string(), Value::String(peer_id.to_string())),
    ]))
    .to_string()
}

/// `R1` — structural, content-blind validation. Rejects anything not shaped like a frame this relay
/// knows how to route, without ever inspecting (or being able to inspect) what `iv`/`ciphertext`
/// would decrypt to.
fn parse_routable(raw: &str) -> Option<(String, Map<String, Value>)> {
    let Ok(Value::Object(object)) = serde_json::from_str::<Value>(raw) else {
        return None;
    };
    let message_type = object.get("type")?.as_str()?.to_string();
    if !KNOWN_MESSAGE_TYPES.contains(&message_type.as_str()) {
        return None;
    }
    Some((message_type, object))
}

/// Overwrites any client-supplied `peerId` with the relay-assigned one, so a peer id is always a fact
/// the relay knows rather than a claim a connection made.
fn stamp_peer_id(mut object: Map<String, Value>, peer_id: &str) -> String {
    object.insert("peerId".to_string(), Value::String(peer_id.to_string()));
    Value::Object(object).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Effectively unlimited, so a test about one rule cannot fail because of `R2`.
    fn registry() -> RoomRegistry {
        RoomRegistry::new(u32::MAX, 60_000)
    }

    fn joined(peers: &[(&str, Role)]) -> RoomRegistry {
        let mut registry = registry();
        for (peer_id, role) in peers {
            registry.join(peer_id, *role, 0);
        }
        registry
    }

    fn field(frame: &str, key: &str) -> String {
        serde_json::from_str::<Value>(frame).unwrap()[key].as_str().unwrap().to_string()
    }

    #[test]
    fn announces_a_new_peer_to_existing_members_but_not_to_itself() {
        let mut registry = registry();
        assert_eq!(registry.join("alice", Role::Editor, 0), vec![Outbound::BroadcastExcept { sender: "alice".into(), frame: signal_frame("peer-joined", "alice") }]);
        assert_eq!(registry.connection_count(), 1);
    }

    #[test]
    fn announces_a_departure_and_stops_tracking_the_connection() {
        let mut registry = joined(&[("alice", Role::Editor)]);
        assert_eq!(registry.leave("alice"), vec![Outbound::BroadcastExcept { sender: "alice".into(), frame: signal_frame("peer-left", "alice") }]);
        assert_eq!(registry.connection_count(), 0);
    }

    #[test]
    fn leaving_an_unknown_peer_is_a_harmless_no_op() {
        let mut registry = registry();
        assert!(registry.leave("nobody").is_empty());
    }

    #[test]
    fn r1_drops_malformed_json() {
        let mut registry = joined(&[("alice", Role::Editor)]);
        assert!(registry.handle_message("alice", "{not json", 0).is_empty());
    }

    #[test]
    fn r1_drops_structurally_invalid_or_unrecognized_messages() {
        let mut registry = joined(&[("alice", Role::Editor)]);
        for raw in ["null", "42", "\"a string\"", "[]", "{}", r#"{"type":123}"#, r#"{"type":"drop-table"}"#] {
            assert!(registry.handle_message("alice", raw, 0).is_empty(), "should have dropped {raw}");
        }
    }

    #[test]
    fn r2_closes_the_connection_once_its_rate_limit_is_exceeded_instead_of_dropping() {
        let mut registry = RoomRegistry::new(2, 60_000);
        registry.join("alice", Role::Editor, 0);
        let frame = r#"{"type":"presence","iv":"x","ciphertext":"y"}"#;

        assert!(matches!(registry.handle_message("alice", frame, 0).as_slice(), [Outbound::BroadcastExcept { .. }]));
        assert!(matches!(registry.handle_message("alice", frame, 0).as_slice(), [Outbound::BroadcastExcept { .. }]));
        assert_eq!(registry.handle_message("alice", frame, 0), vec![Outbound::Close { peer: "alice".into(), code: 1013, reason: "rate limit exceeded" }]);
    }

    #[test]
    fn r2_starts_a_fresh_window_once_the_old_one_elapsed() {
        let mut registry = RoomRegistry::new(1, 60_000);
        registry.join("alice", Role::Editor, 0);
        let frame = r#"{"type":"presence","iv":"x","ciphertext":"y"}"#;

        registry.handle_message("alice", frame, 0);
        assert!(matches!(registry.handle_message("alice", frame, 0).as_slice(), [Outbound::Close { .. }]));
        assert!(matches!(registry.handle_message("alice", frame, 60_000).as_slice(), [Outbound::BroadcastExcept { .. }]));
    }

    #[test]
    fn r3_closes_with_1009_when_a_frame_exceeds_the_cap() {
        let mut registry = joined(&[("alice", Role::Editor)]);
        let oversized = "x".repeat(MAX_MESSAGE_LENGTH + 1);
        assert_eq!(registry.handle_message("alice", &oversized, 0), vec![Outbound::Close { peer: "alice".into(), code: 1009, reason: "message too large" }]);
    }

    #[test]
    fn r3_accepts_a_frame_exactly_at_the_cap() {
        let mut registry = joined(&[("alice", Role::Editor)]);
        // Padded to exactly the cap with a field the relay never looks at, so this asserts the
        // boundary rather than the parser.
        let prefix = r#"{"type":"element-delta","iv":"x","ciphertext":""#;
        let suffix = r#""}"#;
        let padding = "y".repeat(MAX_MESSAGE_LENGTH - prefix.len() - suffix.len());
        let frame = format!("{prefix}{padding}{suffix}");
        assert_eq!(frame.len(), MAX_MESSAGE_LENGTH);

        assert!(matches!(registry.handle_message("alice", &frame, 0).as_slice(), [Outbound::BroadcastExcept { .. }]));
    }

    #[test]
    fn r4_broadcasts_an_element_delta_stamped_with_the_senders_peer_id() {
        let mut registry = joined(&[("alice", Role::Editor), ("bob", Role::Editor)]);

        let out = registry.handle_message("alice", r#"{"type":"element-delta","iv":"aXY=","ciphertext":"Y3Q="}"#, 0);

        let [Outbound::BroadcastExcept { sender, frame }] = out.as_slice() else {
            panic!("expected one broadcast, got {out:?}");
        };
        assert_eq!(sender, "alice");
        assert_eq!(field(frame, "peerId"), "alice");
        assert_eq!(field(frame, "ciphertext"), "Y3Q=");
    }

    #[test]
    fn r4_overwrites_a_client_supplied_peer_id_rather_than_trusting_it() {
        let mut registry = joined(&[("alice", Role::Editor)]);

        let out = registry.handle_message("alice", r#"{"type":"presence","peerId":"bob","iv":"x","ciphertext":"y"}"#, 0);

        let [Outbound::BroadcastExcept { frame, .. }] = out.as_slice() else { panic!("expected one broadcast") };
        assert_eq!(field(frame, "peerId"), "alice");
    }

    #[test]
    fn r4_relays_a_comment_delta_exactly_like_an_element_delta() {
        let mut registry = joined(&[("alice", Role::Editor)]);

        let out = registry.handle_message("alice", r#"{"type":"comment-delta","iv":"x","ciphertext":"y"}"#, 0);

        assert!(matches!(out.as_slice(), [Outbound::BroadcastExcept { .. }]));
    }

    #[test]
    fn r5_unicasts_a_cached_snapshot_to_the_requester_alone() {
        let mut registry = joined(&[("alice", Role::Editor), ("bob", Role::Editor)]);
        registry.handle_message("alice", r#"{"type":"snapshot","iv":"x","ciphertext":"whole-board"}"#, 0);

        let out = registry.handle_message("bob", r#"{"type":"snapshot-request"}"#, 0);

        let [Outbound::Unicast { peer, frame }] = out.as_slice() else {
            panic!("expected a unicast, got {out:?}");
        };
        assert_eq!(peer, "bob");
        assert_eq!(field(frame, "ciphertext"), "whole-board");
        assert_eq!(field(frame, "peerId"), "alice");
    }

    #[test]
    fn r6_broadcasts_snapshot_request_when_no_snapshot_has_ever_been_seen() {
        let mut registry = joined(&[("alice", Role::Editor), ("bob", Role::Editor)]);

        let out = registry.handle_message("bob", r#"{"type":"snapshot-request"}"#, 0);

        assert_eq!(out, vec![Outbound::BroadcastExcept { sender: "bob".into(), frame: r#"{"type":"snapshot-request"}"#.into() }]);
    }

    #[test]
    fn r7_drops_a_viewers_element_delta() {
        let mut registry = joined(&[("viewer", Role::Viewer)]);
        assert!(registry.handle_message("viewer", r#"{"type":"element-delta","iv":"x","ciphertext":"y"}"#, 0).is_empty());
    }

    #[test]
    fn r7_drops_a_viewers_snapshot_which_would_overwrite_the_whole_document() {
        let mut registry = joined(&[("viewer", Role::Viewer)]);
        assert!(registry.handle_message("viewer", r#"{"type":"snapshot","iv":"x","ciphertext":"y"}"#, 0).is_empty());
    }

    #[test]
    fn r7_relays_a_viewers_comment_delta_and_presence() {
        let mut registry = joined(&[("viewer", Role::Viewer)]);
        assert!(matches!(registry.handle_message("viewer", r#"{"type":"comment-delta","iv":"x","ciphertext":"y"}"#, 0).as_slice(), [Outbound::BroadcastExcept { .. }]));
        assert!(matches!(registry.handle_message("viewer", r#"{"type":"presence","iv":"x","ciphertext":"y"}"#, 0).as_slice(), [Outbound::BroadcastExcept { .. }]));
    }

    #[test]
    fn r7_answers_a_viewers_snapshot_request() {
        let mut registry = joined(&[("alice", Role::Editor), ("viewer", Role::Viewer)]);
        registry.handle_message("alice", r#"{"type":"snapshot","iv":"x","ciphertext":"board"}"#, 0);

        let out = registry.handle_message("viewer", r#"{"type":"snapshot-request"}"#, 0);

        assert!(matches!(out.as_slice(), [Outbound::Unicast { .. }]));
    }

    #[test]
    fn r7_does_not_close_a_viewers_connection_over_a_rejected_frame() {
        let mut registry = joined(&[("viewer", Role::Viewer)]);

        let out = registry.handle_message("viewer", r#"{"type":"element-delta","iv":"x","ciphertext":"y"}"#, 0);

        assert!(out.is_empty(), "a rejected frame must not produce a close: {out:?}");
        assert_eq!(registry.connection_count(), 1);
    }

    #[test]
    fn r7_ignores_a_frame_from_a_peer_that_already_left() {
        let mut registry = joined(&[("alice", Role::Editor)]);
        registry.leave("alice");
        assert!(registry.handle_message("alice", r#"{"type":"element-delta","iv":"x","ciphertext":"y"}"#, 0).is_empty());
    }

    #[test]
    fn r3_takes_precedence_over_r7_so_an_oversized_viewer_frame_still_closes() {
        let mut registry = joined(&[("viewer", Role::Viewer)]);
        let oversized = "x".repeat(MAX_MESSAGE_LENGTH + 1);
        assert!(matches!(registry.handle_message("viewer", &oversized, 0).as_slice(), [Outbound::Close { code: 1009, .. }]));
    }
}
