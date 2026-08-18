//! Room role tokens for the LAN relay — the same scheme as `apps/collab-server/src/room-role-token.ts`,
//! specified once in `docs/collab-relay-protocol.md` under "Token scheme".
//!
//! `{role}.{base64url(HMAC-SHA256(secret, "{roomId}|{role}"))}`. A client can present one but cannot
//! mint one, and verification needs no storage at all — recompute and compare — so a LAN room stays a
//! process with a `HashMap` in it rather than something with a database.
//!
//! This is the ONLY file in the LAN relay that touches key material, and it is deliberately outside
//! the message path: consulted once when a connection is upgraded, never per frame. The secret it
//! holds signs a *write permission*; the room's scene key is a different key entirely, one that lives
//! in the URL fragment between humans and reaches no relay. Verifying a token therefore does not
//! interact with the property that this host is structurally incapable of reading what it relays.
//!
//! The one deliberate difference from the Worker: the secret is random per hosting session and lives
//! only in memory. A hosted room outlives deploys and needs a stable configured secret; a LAN room
//! cannot outlive the process that hosts it, so a fresh secret every time is both simpler and
//! strictly better — yesterday's viewer link is dead on arrival tomorrow.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;

use super::registry::Role;

type HmacSha256 = Hmac<Sha256>;

impl Role {
    /// The wire name, which is also the token's cleartext prefix.
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Editor => "editor",
            Role::Viewer => "viewer",
        }
    }

    fn from_str(value: &str) -> Option<Self> {
        match value {
            "editor" => Some(Role::Editor),
            "viewer" => Some(Role::Viewer),
            _ => None,
        }
    }
}

/// Signs `{roomId}|{role}`. Both fields are inside the MAC, so a viewer token minted for one room
/// cannot be replayed against another and a viewer cannot promote themselves by editing the prefix.
pub fn mint_role_token(secret: &[u8], room_id: &str, role: Role) -> String {
    // `new_from_slice` only errors for key sizes HMAC cannot take; HMAC accepts any length.
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC accepts a key of any length");
    mac.update(format!("{room_id}|{}", role.as_str()).as_bytes());
    format!("{}.{}", role.as_str(), URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
}

/// The role `token` proves for `room_id`, or `None` if it proves nothing.
///
/// The claimed role is read from the prefix and then *verified*, never trusted: the MAC is recomputed
/// for that exact claim, so a token whose prefix says `editor` only verifies if it was actually minted
/// as an editor token for this room. An unknown prefix is rejected before any crypto runs.
pub fn verify_role_token(secret: &[u8], room_id: &str, token: &str) -> Option<Role> {
    let (claimed, _) = token.split_once('.')?;
    let role = Role::from_str(claimed)?;
    let expected = mint_role_token(secret, room_id, role);
    timing_safe_eq(expected.as_bytes(), token.as_bytes()).then_some(role)
}

/// Length-then-content comparison that does not return early on the first differing byte. The length
/// itself carries no secret — every token is a known prefix plus a fixed-size MAC — but comparing the
/// bytes must take the same time whether the guess is wrong in the first position or the last, or a
/// caller could recover a valid token one character at a time from response timings.
fn timing_safe_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |difference, (left, right)| difference | (left ^ right)) == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &[u8] = b"a-test-secret";

    #[test]
    fn a_minted_token_verifies_for_the_room_and_role_it_was_minted_for() {
        let token = mint_role_token(SECRET, "room-1", Role::Viewer);
        assert_eq!(verify_role_token(SECRET, "room-1", &token), Some(Role::Viewer));
    }

    #[test]
    fn the_role_prefix_is_readable_without_the_secret_so_a_client_can_render_its_own_chrome() {
        assert!(mint_role_token(SECRET, "room-1", Role::Viewer).starts_with("viewer."));
        assert!(mint_role_token(SECRET, "room-1", Role::Editor).starts_with("editor."));
    }

    #[test]
    fn a_viewer_cannot_promote_itself_by_relabelling_the_prefix() {
        let viewer = mint_role_token(SECRET, "room-1", Role::Viewer);
        let promoted = viewer.replacen("viewer.", "editor.", 1);
        assert_eq!(verify_role_token(SECRET, "room-1", &promoted), None);
    }

    #[test]
    fn a_token_is_bound_to_its_room() {
        let token = mint_role_token(SECRET, "room-1", Role::Editor);
        assert_eq!(verify_role_token(SECRET, "room-2", &token), None);
    }

    #[test]
    fn a_token_signed_with_another_secret_proves_nothing() {
        let token = mint_role_token(b"another-secret", "room-1", Role::Editor);
        assert_eq!(verify_role_token(SECRET, "room-1", &token), None);
    }

    #[test]
    fn a_tampered_mac_proves_nothing() {
        let token = mint_role_token(SECRET, "room-1", Role::Editor);
        let mut tampered: Vec<char> = token.chars().collect();
        let last = tampered.len() - 1;
        tampered[last] = if tampered[last] == 'a' { 'b' } else { 'a' };
        assert_eq!(verify_role_token(SECRET, "room-1", &tampered.into_iter().collect::<String>()), None);
    }

    #[test]
    fn malformed_tokens_are_rejected_before_any_crypto_runs() {
        for token in ["", "editor", "nonsense.abc", ".abc", "EDITOR.abc"] {
            assert_eq!(verify_role_token(SECRET, "room-1", token), None, "should have rejected {token:?}");
        }
    }

    #[test]
    fn a_token_is_url_safe_so_it_survives_a_query_string_unencoded() {
        let token = mint_role_token(SECRET, "room-1", Role::Editor);
        assert!(token.chars().all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character)), "not URL-safe: {token}");
    }
}
