//! The transport half of the LAN relay: TCP, HTTP routing, and WebSocket plumbing around
//! [`RoomRegistry`], which owns every actual decision.
//!
//! The split is the same one the Worker relay uses (`room-durable-object.ts` is glue,
//! `room-connection-registry.ts` is decisions) and for the same reason: the decisions must be
//! testable without a runtime, and there must be exactly one place to read them. Nothing in this file
//! decides whether a frame may be relayed — it reads bytes, hands them to the registry, and carries
//! out the [`Outbound`] actions that come back.
//!
//! HTTP is parsed by hand rather than by pulling in a web framework. The surface is two routes and a
//! WebSocket upgrade, all of it on a private network for the length of one meeting; a framework would
//! be more dependency than protocol. The request head is *peeked*, not consumed, so a request that
//! turns out to be a WebSocket upgrade can be handed to the handshake untouched.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{mpsc, oneshot, watch};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::Message;

use super::registry::{Outbound, Role, RoomRegistry};
use super::tokens::verify_role_token;

/// Per-connection message budget, matching the Worker's `MESSAGES_PER_MINUTE`.
const MESSAGES_PER_MINUTE: u32 = 600;
const RATE_LIMIT_WINDOW_MS: u64 = 60_000;

/// Largest request head accepted before giving up — generous for a URL plus a handshake's headers,
/// small enough that a client dribbling bytes cannot hold memory open.
const MAX_REQUEST_HEAD_BYTES: usize = 8 * 1024;
/// How long a connection has to finish sending its request head before it is dropped.
const REQUEST_HEAD_TIMEOUT: Duration = Duration::from_secs(10);
/// Pause before re-peeking a connection that sent nothing new — see `peek_request_head`.
const STALLED_PEEK_BACKOFF: Duration = Duration::from_millis(5);

/// Total simultaneous connections this host will carry, across all rooms. A LAN room is a meeting;
/// this is far above any real one and far below what would trouble a laptop.
const MAX_CONNECTIONS: usize = 64;

/// Frames that may be queued for one peer before it is considered unable to keep up.
///
/// The queue exists because writing to a socket is async while relaying a decision is not; it is
/// *bounded* because a peer that stops reading would otherwise let its queue grow without limit while
/// the rest of the room keeps drawing — a slow or hostile guest could exhaust the host's memory from
/// nothing but silence. Overflowing disconnects that peer rather than dropping frames for it: a
/// dropped delta diverges its board permanently and invisibly, whereas a reconnect asks for a fresh
/// snapshot and converges. Sized well above any burst a real session produces.
const PEER_QUEUE_CAPACITY: usize = 512;

/// Non-guessable room ids only, matching the Worker's `ROOM_ID_PATTERN` — a room URL is the only way
/// to discover a room, so a short or sequential id would make enumeration trivial.
fn is_valid_room_id(room_id: &str) -> bool {
    (8..=128).contains(&room_id.len()) && room_id.chars().all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
}

struct Room {
    registry: RoomRegistry,
    peers: HashMap<String, mpsc::Sender<Message>>,
}

pub struct RelayState {
    /// Signs role tokens. Random per hosting session and never written anywhere — see `tokens.rs`.
    secret: Vec<u8>,
    rooms: Mutex<HashMap<String, Room>>,
    /// Monotonic time base for the rate limiter. `Instant`, not the wall clock, so a clock adjustment
    /// mid-session cannot hand every connection an unlimited budget or an instant lockout.
    started: Instant,
    /// Flipped once when hosting stops. Every live connection task watches it, because tasks are
    /// spawned detached: without this, ending the accept loop would stop *new* connections while
    /// leaving everyone already in the room connected to a relay the host believes they shut down.
    stopping: watch::Sender<bool>,
}

impl RelayState {
    pub fn new(secret: Vec<u8>) -> Self {
        Self { secret, rooms: Mutex::new(HashMap::new()), started: Instant::now(), stopping: watch::channel(false).0 }
    }

    pub fn secret(&self) -> &[u8] {
        &self.secret
    }

    fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    fn total_connections(&self) -> usize {
        self.rooms().values().map(|room| room.peers.len()).sum()
    }

    /// Recovers from a poisoned lock rather than propagating the panic. A panic while this lock was
    /// held would otherwise take down every *subsequent* connection too, turning one bug into a dead
    /// relay; the guarded state is a connection map whose worst case after a partial update is a
    /// stale entry that the next `leave` removes.
    fn rooms(&self) -> std::sync::MutexGuard<'_, HashMap<String, Room>> {
        self.rooms.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Serves until `shutdown` fires. Returning drops every connection task's sender, which ends each
/// writer task, which closes each socket — so stopping the host really does disconnect the room
/// rather than leaving peers on a relay nobody is watching.
pub async fn serve(listener: TcpListener, state: Arc<RelayState>, mut shutdown: oneshot::Receiver<()>) {
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                // Tells every live connection to close, then returns. Ignored if there are none.
                let _ = state.stopping.send(true);
                return;
            }
            accepted = listener.accept() => {
                let Ok((stream, peer_address)) = accepted else { continue };
                let state = Arc::clone(&state);
                tokio::spawn(async move { handle_connection(stream, peer_address, state).await });
            }
        }
    }
}

async fn handle_connection(stream: TcpStream, _peer_address: SocketAddr, state: Arc<RelayState>) {
    let Ok(Ok(head)) = tokio::time::timeout(REQUEST_HEAD_TIMEOUT, peek_request_head(&stream)).await else {
        return;
    };
    let head_len = head.len();
    let Some(request) = parse_request_head(&head) else {
        respond(stream, head_len, 400, "text/plain; charset=utf-8", "bad request").await;
        return;
    };

    // Deliberately NOT served: `POST /room`, which the Worker relay offers for minting a room. The
    // host mints its own room in-process when hosting starts, so the route would have no caller — and
    // an unauthenticated "allocate me a room" endpoint on somebody's personal machine is a liability
    // with nothing on the other side of the trade.
    match (request.method.as_str(), request.path.as_str()) {
        // Preflight. A LAN relay holds nothing an origin check would protect — it only relays
        // ciphertext to token-holders — and the app's own webview is itself a cross-origin caller, so
        // the permissive answer is the honest one rather than a hole.
        ("OPTIONS", _) => respond(stream, head_len, 204, "text/plain; charset=utf-8", "").await,
        ("GET", path) if path.starts_with("/room/") => serve_room(stream, head_len, request, state).await,
        _ => respond(stream, head_len, 404, "text/plain; charset=utf-8", "not found").await,
    }
}

async fn serve_room(stream: TcpStream, head_len: usize, request: RequestHead, state: Arc<RelayState>) {
    let room_id = request.path.trim_start_matches("/room/").trim_end_matches('/').to_string();
    if !is_valid_room_id(&room_id) {
        respond(stream, head_len, 400, "text/plain; charset=utf-8", "invalid room id").await;
        return;
    }

    // A plain GET is somebody who opened the join link in a browser — most likely by scanning the QR
    // code with a phone. A browser cannot join a `ws://` LAN room from an HTTPS page, so the honest
    // answer is a page saying so, not a dead socket or a blank 426.
    if !request.wants_websocket_upgrade {
        respond(stream, head_len, 200, "text/html; charset=utf-8", JOIN_PAGE_HTML).await;
        return;
    }

    // Every connection must present a token this hosting session signed. This is the one place the LAN
    // relay is deliberately STRICTER than the Worker, which admits a tokenless connection as an editor
    // so that room links minted before roles existed keep working. No such link can exist here: a LAN
    // room is minted fresh when hosting starts and dies when it stops, so there is no legacy to
    // preserve — and the cost of keeping the rule would be that any device on the network could open
    // a room on somebody's laptop just by inventing a room id. Requiring a token means a stranger who
    // does not hold the invite link cannot make this process allocate anything at all.
    let role = request.role_token.as_deref().and_then(|token| verify_role_token(state.secret(), &room_id, token));
    let Some(role) = role else {
        respond(stream, head_len, 403, "text/plain; charset=utf-8", "invalid room token").await;
        return;
    };

    // Belt and braces behind the token check: a legitimate link-holder should still not be able to
    // exhaust the host by opening connections in a loop. A LAN room is a meeting, not a broadcast.
    if state.total_connections() >= MAX_CONNECTIONS {
        respond(stream, head_len, 503, "text/plain; charset=utf-8", "room is full").await;
        return;
    }

    // The handshake re-reads the request head, which is why it was only peeked above.
    let Ok(socket) = tokio_tungstenite::accept_async(stream).await else { return };
    run_peer(socket, room_id, role, state).await;
}

async fn run_peer(socket: tokio_tungstenite::WebSocketStream<TcpStream>, room_id: String, role: Role, state: Arc<RelayState>) {
    let peer_id = uuid::Uuid::new_v4().to_string();
    let (mut sink, mut incoming) = socket.split();
    let (outbound_sender, mut outbound_receiver) = mpsc::channel::<Message>(PEER_QUEUE_CAPACITY);

    // One writer task owns the sink, so every send site can stay synchronous behind a channel — which
    // is what lets the registry's decisions be applied while holding the rooms lock without ever
    // awaiting inside it.
    let writer = tokio::spawn(async move {
        while let Some(message) = outbound_receiver.recv().await {
            let is_close = matches!(message, Message::Close(_));
            if sink.send(message).await.is_err() || is_close {
                break;
            }
        }
        let _ = sink.close().await;
    });

    {
        let mut rooms = state.rooms();
        let room = rooms
            .entry(room_id.clone())
            .or_insert_with(|| Room { registry: RoomRegistry::new(MESSAGES_PER_MINUTE, RATE_LIMIT_WINDOW_MS), peers: HashMap::new() });
        let announcements = room.registry.join(&peer_id, role, state.now_ms());
        room.peers.insert(peer_id.clone(), outbound_sender);
        let unreachable = dispatch(room, announcements);
        drop_unreachable(room, unreachable);
    }

    let mut stopping = state.stopping.subscribe();
    loop {
        let message = tokio::select! {
            _ = stopping.changed() => {
                // Hosting stopped. Close politely so the peer's client reports a closed session
                // rather than a network error it will try to reconnect through.
                if let Some(sender) = state.rooms().get(&room_id).and_then(|room| room.peers.get(&peer_id)) {
                    let _ = sender.try_send(Message::Close(None));
                }
                break;
            }
            incoming = incoming.next() => match incoming {
                Some(Ok(message)) => message,
                _ => break,
            },
        };
        // Only text frames carry this protocol. A binary frame is silently ignored rather than
        // treated as a violation: it is a client bug, and dropping the room over it helps nobody.
        let Message::Text(raw) = message else { continue };
        let mut rooms = state.rooms();
        let Some(room) = rooms.get_mut(&room_id) else { break };
        let actions = room.registry.handle_message(&peer_id, raw.as_ref(), state.now_ms());
        let unreachable = dispatch(room, actions);
        drop_unreachable(room, unreachable);
    }

    {
        let mut rooms = state.rooms();
        if let Some(room) = rooms.get_mut(&room_id) {
            let announcements = room.registry.leave(&peer_id);
            room.peers.remove(&peer_id);
            let unreachable = dispatch(room, announcements);
            drop_unreachable(room, unreachable);
            // An empty room is dropped entirely, taking its cached snapshot with it. Nothing here is
            // durable by design: the host's own document is the copy that survives.
            if room.peers.is_empty() {
                rooms.remove(&room_id);
            }
        }
    }
    let _ = writer.await;
}

/// Carries out the registry's decisions, returning any peer that could not be written to.
///
/// Every send is a non-blocking `try_send`, so this never awaits and is safe to call while the rooms
/// lock is held. A failure means the peer's bounded queue is full (it has stopped reading) or already
/// closed; either way it is no longer a participant, and the caller drops it. Reported rather than
/// handled here so this stays a pure "carry out the decisions" step.
#[must_use]
fn dispatch(room: &Room, actions: Vec<Outbound>) -> Vec<String> {
    let mut unreachable = Vec::new();
    let mut send = |peer_id: &String, message: Message| {
        if let Some(sender) = room.peers.get(peer_id) {
            if sender.try_send(message).is_err() && !unreachable.contains(peer_id) {
                unreachable.push(peer_id.clone());
            }
        }
    };
    for action in actions {
        match action {
            Outbound::Unicast { peer, frame } => send(&peer, Message::Text(frame)),
            Outbound::BroadcastExcept { sender: excluded, frame } => {
                for peer_id in room.peers.keys().filter(|peer_id| **peer_id != excluded).cloned().collect::<Vec<_>>() {
                    send(&peer_id, Message::Text(frame.clone()));
                }
            }
            // A close frame is the last thing this peer will be sent, so a full queue is not a reason
            // to also report it unreachable — dropping its sender below closes the socket regardless.
            Outbound::Close { peer, code, reason } => {
                if let Some(sender) = room.peers.get(&peer) {
                    let _ = sender.try_send(Message::Close(Some(CloseFrame { code: CloseCode::from(code), reason: reason.into() })));
                }
            }
        }
    }
    unreachable
}

/// Drops peers that could no longer be written to, announcing each departure to the rest.
///
/// One pass, deliberately not recursive: an announcement that itself fails to reach a third peer
/// marks that peer on the *next* frame instead of unwinding the room in one go.
fn drop_unreachable(room: &mut Room, unreachable: Vec<String>) {
    for peer_id in unreachable {
        let announcements = room.registry.leave(&peer_id);
        // Dropping the sender ends that peer's writer task, which closes its socket.
        room.peers.remove(&peer_id);
        let _ = dispatch(room, announcements);
    }
}

struct RequestHead {
    method: String,
    path: String,
    role_token: Option<String>,
    wants_websocket_upgrade: bool,
}

/// Reads the request head **without consuming it**, so a WebSocket upgrade can still be handed to the
/// handshake, which parses the same bytes itself.
async fn peek_request_head(stream: &TcpStream) -> std::io::Result<Vec<u8>> {
    let mut buffer = vec![0u8; MAX_REQUEST_HEAD_BYTES];
    let mut seen = 0;
    loop {
        stream.readable().await?;
        let read = match stream.peek(&mut buffer).await {
            Ok(0) => return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "closed before a request head arrived")),
            Ok(read) => read,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => continue,
            Err(error) => return Err(error),
        };
        if buffer[..read].windows(4).any(|window| window == b"\r\n\r\n") {
            return Ok(buffer[..read].to_vec());
        }
        if read == MAX_REQUEST_HEAD_BYTES {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "request head too large"));
        }
        // Peeking does not consume, so the socket stays readable and `readable()` returns instantly:
        // a client that sends half a request and then goes quiet would spin this task at full CPU
        // until the timeout. Only wait when no new bytes arrived, so a normal request — whose head
        // lands in the first peek — never pays for this at all.
        if read == seen {
            tokio::time::sleep(STALLED_PEEK_BACKOFF).await;
        }
        seen = read;
    }
}

fn parse_request_head(head: &[u8]) -> Option<RequestHead> {
    let text = std::str::from_utf8(head).ok()?;
    let mut lines = text.split("\r\n");
    let mut request_line = lines.next()?.split(' ');
    let method = request_line.next()?.to_string();
    let target = request_line.next()?;

    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    let role_token = query.split('&').filter_map(|pair| pair.split_once('=')).find(|(key, _)| *key == "t").map(|(_, value)| percent_decode(value));

    // A WebSocket upgrade is `Connection: Upgrade` + `Upgrade: websocket`, both case-insensitive, and
    // `Connection` may list several tokens.
    let mut upgrade_to_websocket = false;
    let mut connection_upgrade = false;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else { continue };
        let value = value.trim().to_ascii_lowercase();
        match name.trim().to_ascii_lowercase().as_str() {
            "upgrade" => upgrade_to_websocket = value.split(',').any(|token| token.trim() == "websocket"),
            "connection" => connection_upgrade = value.split(',').any(|token| token.trim() == "upgrade"),
            _ => {}
        }
    }

    Some(RequestHead { method, path: path.to_string(), role_token, wants_websocket_upgrade: upgrade_to_websocket && connection_upgrade })
}

/// Just enough percent-decoding for a role token in a query string. Tokens are base64url plus a `.`,
/// so they never need encoding at all — this exists only so a client that encodes anyway still works.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or(""), 16) {
                decoded.push(byte);
                index += 3;
                continue;
            }
        }
        decoded.push(if bytes[index] == b'+' { b' ' } else { bytes[index] });
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

/// Replies to a non-WebSocket request and closes.
///
/// `head_len` is consumed first, and the write half is shut down explicitly afterwards. Both matter:
/// the request was only *peeked*, so it is still sitting in the receive buffer, and closing a socket
/// with unread data queued makes the OS send a reset — which discards the response that was just
/// written. The symptom is a browser showing a connection error on a page that was in fact answered.
async fn respond(mut stream: TcpStream, head_len: usize, status: u16, content_type: &str, body: &str) {
    let mut consumed = vec![0u8; head_len];
    let _ = tokio::io::AsyncReadExt::read_exact(&mut stream, &mut consumed).await;
    let reason = match status {
        200 => "OK",
        201 => "Created",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        503 => "Service Unavailable",
        _ => "Not Found",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\naccess-control-allow-origin: *\r\naccess-control-allow-methods: GET, POST, OPTIONS\r\nconnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;
    let _ = stream.shutdown().await;
}

/// What a browser sees if someone opens (or scans) a LAN join link. Deliberately plain text in plain
/// HTML with no styling to theme and nothing to load — it exists so a wrong turn explains itself.
const JOIN_PAGE_HTML: &str = r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deviva Draw room</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1.5rem;line-height:1.6">
<h1 style="font-size:1.25rem">This is a Deviva Draw room</h1>
<p>It is hosted on this local network. Open this link in the <strong>Deviva Draw desktop app</strong> &mdash; Collaborate, then paste the link.</p>
<p>A web browser cannot join a local-network room: the page would have to open an unencrypted connection from an encrypted page, which browsers block.</p>
</body></html>"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_the_room_ids_the_relay_mints_and_rejects_guessable_ones() {
        assert!(is_valid_room_id(&uuid::Uuid::new_v4().to_string()));
        assert!(!is_valid_room_id("short"));
        assert!(!is_valid_room_id(""));
        assert!(!is_valid_room_id(&"x".repeat(129)));
        assert!(!is_valid_room_id("has/slash/in-it"));
        assert!(!is_valid_room_id("has space in it"));
    }

    #[test]
    fn reads_a_websocket_upgrade_with_its_token() {
        let head = b"GET /room/abcdefgh?t=viewer.mac HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: keep-alive, Upgrade\r\n\r\n";
        let request = parse_request_head(head).expect("should parse");
        assert_eq!(request.method, "GET");
        assert_eq!(request.path, "/room/abcdefgh");
        assert_eq!(request.role_token.as_deref(), Some("viewer.mac"));
        assert!(request.wants_websocket_upgrade);
    }

    #[test]
    fn a_plain_get_is_not_an_upgrade() {
        let head = b"GET /room/abcdefgh HTTP/1.1\r\nHost: x\r\n\r\n";
        let request = parse_request_head(head).expect("should parse");
        assert!(!request.wants_websocket_upgrade);
        assert_eq!(request.role_token, None);
    }

    #[test]
    fn an_upgrade_header_without_a_connection_upgrade_is_not_an_upgrade() {
        let head = b"GET /room/abcdefgh HTTP/1.1\r\nUpgrade: websocket\r\nConnection: keep-alive\r\n\r\n";
        assert!(!parse_request_head(head).expect("should parse").wants_websocket_upgrade);
    }

    #[test]
    fn decodes_a_percent_encoded_token() {
        let head = b"GET /room/abcdefgh?t=viewer%2Emac&other=1 HTTP/1.1\r\nHost: x\r\n\r\n";
        assert_eq!(parse_request_head(head).unwrap().role_token.as_deref(), Some("viewer.mac"));
    }

    #[test]
    fn rejects_a_head_that_is_not_a_request_line() {
        assert!(parse_request_head(b"\r\n\r\n").is_none());
    }

    fn room_with(peer_id: &str, capacity: usize) -> (Room, mpsc::Receiver<Message>) {
        let mut room = Room { registry: RoomRegistry::new(u32::MAX, 60_000), peers: HashMap::new() };
        let (sender, receiver) = mpsc::channel(capacity);
        let _ = room.registry.join(peer_id, Role::Editor, 0);
        room.peers.insert(peer_id.to_string(), sender);
        (room, receiver)
    }

    fn frames(count: usize) -> Vec<Outbound> {
        (0..count).map(|_| Outbound::Unicast { peer: "stuck".to_string(), frame: r#"{"type":"presence"}"#.to_string() }).collect()
    }

    /// The host's memory is the thing being protected here. Without a bound, a guest that simply stops
    /// reading its socket while the room keeps drawing grows a queue on the host machine forever.
    #[test]
    fn a_peer_that_stopped_reading_is_dropped_rather_than_queued_forever() {
        let (mut room, _receiver) = room_with("stuck", 2);

        // One more frame than the queue can hold, with nothing ever read off the other end.
        let unreachable = dispatch(&room, frames(3));

        assert_eq!(unreachable, vec!["stuck".to_string()]);
        drop_unreachable(&mut room, unreachable);
        assert!(room.peers.is_empty(), "an unreachable peer must be dropped, not left in the room");
    }

    #[test]
    fn a_peer_still_keeping_up_is_left_alone() {
        let (room, _receiver) = room_with("fine", 8);
        assert!(dispatch(&room, frames(2).into_iter().map(|_| Outbound::Unicast { peer: "fine".to_string(), frame: "{}".to_string() }).collect()).is_empty());
    }

    #[test]
    fn a_peer_whose_socket_task_is_already_gone_is_reported_too() {
        let (mut room, receiver) = room_with("gone", 8);
        drop(receiver); // the writer task ended, e.g. the socket errored

        let unreachable = dispatch(&room, frames(1).into_iter().map(|_| Outbound::Unicast { peer: "gone".to_string(), frame: "{}".to_string() }).collect());

        assert_eq!(unreachable, vec!["gone".to_string()]);
        drop_unreachable(&mut room, unreachable);
        assert!(room.peers.is_empty());
    }

    /// Over a real socket, on a real loopback port.
    ///
    /// The registry's own tests prove the decisions; these prove the decisions actually reach the
    /// wire — that a frame survives the handshake, the role from the URL is the role the registry
    /// enforces, and stopping the host really disconnects people. That last one is the whole
    /// difference between "the relay stopped" and "everyone thinks they are still in a room".
    mod over_the_wire {
        use super::*;
        use futures_util::SinkExt;
        use tokio_tungstenite::connect_async;

        /// Binds an ephemeral port so tests never collide with each other or with a real host.
        async fn start_relay() -> (u16, Arc<RelayState>, oneshot::Sender<()>) {
            let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind loopback");
            let port = listener.local_addr().unwrap().port();
            let state = Arc::new(RelayState::new(b"integration-test-secret".to_vec()));
            let (shutdown, shutdown_receiver) = oneshot::channel();
            tokio::spawn(serve(listener, Arc::clone(&state), shutdown_receiver));
            (port, state, shutdown)
        }

        async fn join(port: u16, room_id: &str, token: Option<&str>) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
            let query = token.map(|token| format!("?t={token}")).unwrap_or_default();
            let (socket, _) = connect_async(format!("ws://127.0.0.1:{port}/room/{room_id}{query}")).await.expect("should connect");
            socket
        }

        /// Joins as an editor, the way the app does — with a token this hosting session signed.
        async fn join_as_editor(port: u16, state: &Arc<RelayState>) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
            let token = crate::lan_relay::tokens::mint_role_token(state.secret(), ROOM, Role::Editor);
            join(port, ROOM, Some(&token)).await
        }

        /// Reads until a frame of `message_type` arrives, so a test asserting about an element delta is
        /// not derailed by the `peer-joined` that legitimately precedes it.
        async fn next_of_type(socket: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>, message_type: &str) -> serde_json::Value {
            loop {
                let message = tokio::time::timeout(Duration::from_secs(2), socket.next()).await.expect("timed out waiting for a frame").expect("stream ended").expect("read error");
                let Message::Text(raw) = message else { continue };
                let value: serde_json::Value = serde_json::from_str(raw.as_ref()).expect("relayed a non-JSON frame");
                if value["type"] == message_type {
                    return value;
                }
            }
        }

        const ROOM: &str = "integration-room-0001";

        #[tokio::test]
        async fn two_peers_exchange_an_element_delta_through_the_relay() {
            let (port, state, _shutdown) = start_relay().await;
            let mut alice = join_as_editor(port, &state).await;
            let mut bob = join_as_editor(port, &state).await;
            // Alice sees Bob arrive; without waiting, her delta could be relayed before Bob is registered.
            next_of_type(&mut alice, "peer-joined").await;

            alice.send(Message::Text(r#"{"type":"element-delta","iv":"aXY","ciphertext":"c2hhcGU"}"#.into())).await.unwrap();

            let received = next_of_type(&mut bob, "element-delta").await;
            assert_eq!(received["ciphertext"], "c2hhcGU");
            assert!(received["peerId"].is_string(), "the relay must stamp its own peer id");
        }

        #[tokio::test]
        async fn a_viewer_token_is_enforced_at_the_relay_not_by_the_client() {
            let (port, state, _shutdown) = start_relay().await;
            let viewer_token = crate::lan_relay::tokens::mint_role_token(state.secret(), ROOM, Role::Viewer);
            let mut editor = join_as_editor(port, &state).await;
            let mut viewer = join(port, ROOM, Some(&viewer_token)).await;
            next_of_type(&mut editor, "peer-joined").await;

            // A hand-crafted frame from a client that simply ignores its own read-only chrome.
            viewer.send(Message::Text(r#"{"type":"element-delta","iv":"x","ciphertext":"smuggled"}"#.into())).await.unwrap();
            // ...followed by one it IS allowed to send, so the assertion is "the first never arrived"
            // rather than "nothing arrived yet".
            viewer.send(Message::Text(r#"{"type":"comment-delta","iv":"x","ciphertext":"allowed"}"#.into())).await.unwrap();

            let received = next_of_type(&mut editor, "comment-delta").await;
            assert_eq!(received["ciphertext"], "allowed");
        }

        #[tokio::test]
        async fn a_token_that_does_not_verify_is_refused_at_the_handshake() {
            let (port, state, _shutdown) = start_relay().await;
            let viewer_token = crate::lan_relay::tokens::mint_role_token(state.secret(), ROOM, Role::Viewer);
            let promoted = viewer_token.replacen("viewer.", "editor.", 1);

            let result = connect_async(format!("ws://127.0.0.1:{port}/room/{ROOM}?t={promoted}")).await;

            assert!(result.is_err(), "a relabelled token must not upgrade");
        }

        #[tokio::test]
        async fn a_snapshot_request_is_answered_from_the_cache_without_disturbing_anyone_else() {
            let (port, state, _shutdown) = start_relay().await;
            let mut alice = join_as_editor(port, &state).await;
            let mut bob = join_as_editor(port, &state).await;
            next_of_type(&mut alice, "peer-joined").await;
            alice.send(Message::Text(r#"{"type":"snapshot","iv":"x","ciphertext":"whole-board"}"#.into())).await.unwrap();
            next_of_type(&mut bob, "snapshot").await;

            let mut carol = join_as_editor(port, &state).await;
            carol.send(Message::Text(r#"{"type":"snapshot-request"}"#.into())).await.unwrap();

            assert_eq!(next_of_type(&mut carol, "snapshot").await["ciphertext"], "whole-board");
        }

        #[tokio::test]
        async fn stopping_the_host_disconnects_everyone() {
            let (port, state, shutdown) = start_relay().await;
            let mut alice = join_as_editor(port, &state).await;

            drop(shutdown);
            // `serve` returning drops the listener and every connection task's handle.
            let closed = tokio::time::timeout(Duration::from_secs(5), async {
                while let Some(Ok(_)) = alice.next().await {}
            })
            .await;

            assert!(closed.is_ok(), "the socket should have closed when hosting stopped");
        }

        #[tokio::test]
        async fn a_browser_opening_the_join_link_is_told_where_to_go() {
            let (port, _state, _shutdown) = start_relay().await;
            let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            stream.write_all(format!("GET /room/{ROOM} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").as_bytes()).await.unwrap();

            let mut response = Vec::new();
            tokio::time::timeout(Duration::from_secs(2), tokio::io::AsyncReadExt::read_to_end(&mut stream, &mut response)).await.unwrap().unwrap();

            let text = String::from_utf8_lossy(&response);
            assert!(text.starts_with("HTTP/1.1 200 OK"), "got {text}");
            assert!(text.contains("desktop app"), "the page must say where to open the link");
        }

        /// The LAN relay's one deliberate departure from the Worker, and the reason a stranger on the
        /// same network cannot make this process allocate anything: without the invite link's token
        /// there is no connection, so there is no room, no peer map, and no queue.
        #[tokio::test]
        async fn a_connection_with_no_token_is_refused_even_though_the_worker_would_admit_it() {
            let (port, _state, _shutdown) = start_relay().await;
            assert!(connect_async(format!("ws://127.0.0.1:{port}/room/{ROOM}")).await.is_err());
        }

        #[tokio::test]
        async fn a_token_minted_for_another_room_does_not_open_this_one() {
            let (port, state, _shutdown) = start_relay().await;
            let elsewhere = crate::lan_relay::tokens::mint_role_token(state.secret(), "some-other-room-id", Role::Editor);
            assert!(connect_async(format!("ws://127.0.0.1:{port}/room/{ROOM}?t={elsewhere}")).await.is_err());
        }

        /// `POST /room` is the Worker's room-minting route. Serving it here would let anyone on the
        /// network allocate on somebody's laptop, and nothing would call it.
        #[tokio::test]
        async fn the_relay_does_not_mint_rooms_over_http() {
            let (port, _state, _shutdown) = start_relay().await;
            let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            stream.write_all(b"POST /room HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").await.unwrap();

            let mut response = Vec::new();
            tokio::time::timeout(Duration::from_secs(2), tokio::io::AsyncReadExt::read_to_end(&mut stream, &mut response)).await.unwrap().unwrap();

            assert!(String::from_utf8_lossy(&response).starts_with("HTTP/1.1 404"));
        }

        #[tokio::test]
        async fn a_guessable_room_id_is_refused() {
            let (port, _state, _shutdown) = start_relay().await;
            assert!(connect_async(format!("ws://127.0.0.1:{port}/room/short")).await.is_err());
        }
    }
}
