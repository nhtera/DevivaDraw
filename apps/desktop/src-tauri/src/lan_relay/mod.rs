//! Hosting a collaboration room on the local network, from the desktop app.
//!
//! The point is a room with no internet in it: a workshop, a classroom, a team behind an air gap.
//! Everything the hosted relay does, this does on the host's own machine — same protocol
//! (`docs/collab-relay-protocol.md`), same role enforcement, same end-to-end encryption. The host
//! machine relays ciphertext it cannot read, exactly as Cloudflare does, because the room's key
//! travels in the URL fragment between humans and never reaches a relay.
//!
//! Module layout mirrors the responsibilities:
//!
//! - [`registry`] — the `R1`…`R7` decision table, runtime-free and unit-tested.
//! - [`server`] — TCP, HTTP routing, WebSocket plumbing. Decides nothing.
//! - [`tokens`] — role tokens. The only file here that touches key material, and it sits outside the
//!   message path.
//! - [`addresses`] — which of the machine's addresses to publish as the join URL's host.
//!
//! The room id and both role tokens are minted **here**, not over HTTP, and handed to the frontend as
//! the command's return value. Two things follow, both deliberate. The desktop client only ever opens
//! a WebSocket to a LAN address, so the app's content-security policy has to permit `ws:` and nothing
//! else — one capability instead of two, for the same feature. And the Worker's `POST /room` route is
//! not served at all: it would have no caller, and an unauthenticated "allocate me a room" endpoint
//! on somebody's personal machine is a liability with nothing on the other side of the trade.

pub mod addresses;
pub mod registry;
pub mod server;
pub mod tokens;

use std::sync::{Arc, Mutex};

use tokio::net::TcpListener;
use tokio::sync::oneshot;

use addresses::HostAddress;
use registry::Role;
use server::RelayState;

/// Default listening port. Nothing standard claims it, and a fixed default means a host who has done
/// this before can predict the URL. Overridable because "that port is taken" must have an answer.
pub const DEFAULT_LAN_PORT: u16 = 7373;

/// Three states, not two, because binding a port is asynchronous: without an explicit `Starting` the
/// "am I already hosting?" check and the recording of the result are separated by an `await`, and two
/// concurrent starts can both pass the check. The second listener would then be bound but unrecorded
/// — and therefore impossible to stop.
#[derive(Default)]
enum HostState {
    #[default]
    Idle,
    Starting,
    Running {
        port: u16,
        /// Dropping or firing this ends `server::serve`, which drops every connection.
        shutdown: oneshot::Sender<()>,
    },
}

/// Tauri-managed state: at most one relay per app, since a second one would be a second room nobody
/// asked for and a second port to explain.
#[derive(Default)]
pub struct LanHostState {
    state: Mutex<HostState>,
}

impl LanHostState {
    /// Recovers a poisoned lock rather than cascading the panic into every later command.
    fn locked(&self) -> std::sync::MutexGuard<'_, HostState> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Atomically claims the right to start. `false` means somebody already holds it.
    fn claim_start(&self) -> bool {
        let mut state = self.locked();
        if matches!(*state, HostState::Idle) {
            *state = HostState::Starting;
            return true;
        }
        false
    }
}

/// Everything the frontend needs to build a join URL. Deliberately *not* the URL itself: the room key
/// is generated in the browser layer and must never cross this boundary, so assembling the link is
/// the frontend's job and this side never sees a complete one.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanRoom {
    pub port: u16,
    /// Private IPv4s this machine holds, best candidate first. Empty means no local network.
    pub addresses: Vec<HostAddress>,
    pub room_id: String,
    pub editor_token: String,
    pub viewer_token: String,
}

/// Starts hosting and mints one room on it.
///
/// Fails rather than restarting if a relay is already running: silently replacing it would drop
/// everyone already in the room to produce a link the host did not know they needed.
#[tauri::command]
pub async fn start_lan_relay(port: Option<u16>, state: tauri::State<'_, LanHostState>) -> Result<LanRoom, String> {
    if !state.claim_start() {
        return Err("already-hosting".to_string());
    }

    let requested = port.unwrap_or(DEFAULT_LAN_PORT);
    // `0.0.0.0` so every interface can reach it — the published address decides which one people are
    // told about, not which one works.
    let bind_result = TcpListener::bind(("0.0.0.0", requested)).await.map_err(|error| match error.kind() {
        std::io::ErrorKind::AddrInUse => "port-in-use".to_string(),
        // macOS asks for local-network permission the first time; a denial surfaces here.
        std::io::ErrorKind::PermissionDenied => "permission-denied".to_string(),
        _ => format!("bind-failed: {error}"),
    });
    // Any failure from here on has to hand the claim back, or a single refused bind would leave the
    // app reporting "already-hosting" forever with nothing actually running.
    let listener = match bind_result {
        Ok(listener) => listener,
        Err(reason) => {
            *state.locked() = HostState::Idle;
            return Err(reason);
        }
    };
    let bound_port = match listener.local_addr() {
        Ok(address) => address.port(),
        Err(error) => {
            *state.locked() = HostState::Idle;
            return Err(format!("bind-failed: {error}"));
        }
    };

    let relay = Arc::new(RelayState::new(session_secret()));
    let room_id = uuid::Uuid::new_v4().to_string();
    let room = LanRoom {
        port: bound_port,
        addresses: addresses::private_ipv4_addresses(),
        editor_token: tokens::mint_role_token(relay.secret(), &room_id, Role::Editor),
        viewer_token: tokens::mint_role_token(relay.secret(), &room_id, Role::Viewer),
        room_id,
    };

    let (shutdown_sender, shutdown_receiver) = oneshot::channel();
    tauri::async_runtime::spawn(async move { server::serve(listener, relay, shutdown_receiver).await });
    *state.locked() = HostState::Running { port: bound_port, shutdown: shutdown_sender };

    Ok(room)
}

/// Stops hosting, closing every connection. A no-op when nothing is running, so a UI that stops twice
/// (or stops on unmount after the user already stopped) does not need to guard the call.
#[tauri::command]
pub async fn stop_lan_relay(state: tauri::State<'_, LanHostState>) -> Result<(), String> {
    if let HostState::Running { shutdown, .. } = std::mem::replace(&mut *state.locked(), HostState::Idle) {
        let _ = shutdown.send(());
    }
    Ok(())
}

/// Private addresses this machine currently holds, best candidate first. Callable without hosting, so
/// the UI can offer the choice of network *before* binding a port rather than after.
#[tauri::command]
pub fn lan_host_addresses() -> Vec<HostAddress> {
    addresses::private_ipv4_addresses()
}

/// The port currently being hosted on, or `null`. Lets the frontend recover its own hosting state
/// after a reload without the shell having to push events at it.
#[tauri::command]
pub fn lan_relay_port(state: tauri::State<'_, LanHostState>) -> Option<u16> {
    match &*state.locked() {
        HostState::Running { port, .. } => Some(*port),
        _ => None,
    }
}

/// 256 bits of randomness for this hosting session's token secret, from the same CSPRNG that produces
/// v4 UUIDs (two of them, since one carries 122 random bits). It is never written to disk and never
/// leaves this process: a LAN room cannot outlive the process hosting it, so a secret that does would
/// be a liability with no matching benefit.
fn session_secret() -> Vec<u8> {
    let mut secret = uuid::Uuid::new_v4().as_bytes().to_vec();
    secret.extend_from_slice(uuid::Uuid::new_v4().as_bytes());
    secret
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Binding a port is asynchronous, so the guard has to be a claim, not a look. Two starts racing
    /// must not both proceed — the loser's listener would be bound but unrecorded, and nothing could
    /// ever stop it.
    #[test]
    fn only_one_start_can_claim_the_host_at_a_time() {
        let state = LanHostState::default();
        assert!(state.claim_start());
        assert!(!state.claim_start(), "a second start must be refused while the first is in flight");
    }

    /// A refused bind (port in use, permission denied) has to hand the claim back, or the app reports
    /// "already-hosting" forever while nothing is running.
    #[test]
    fn a_failed_start_releases_the_claim() {
        let state = LanHostState::default();
        assert!(state.claim_start());
        *state.locked() = HostState::Idle;
        assert!(state.claim_start(), "hosting must be startable again after a failure");
    }

    #[test]
    fn a_relay_that_is_only_starting_reports_no_port_yet() {
        let state = LanHostState::default();
        state.claim_start();
        assert_eq!(match &*state.locked() { HostState::Running { port, .. } => Some(*port), _ => None }, None);
    }
}
