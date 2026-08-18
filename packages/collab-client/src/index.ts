/**
 * @deviva-draw/collab-client — realtime sync client for the Deviva Draw
 * engine: WebSocket transport, end-to-end encryption, presence, and
 * last-writer-wins conflict resolution over element versions.
 */
export const COLLAB_CLIENT_VERSION = "0.1.0";

export type { CollabConnectionStatus, CollabSessionOptions } from "./collab-session";
export { CollabSession } from "./collab-session";

export type { ConnectionManagerOptions, WebSocketLike } from "./connection-manager";
export { computeReconnectDelayMs, ConnectionManager } from "./connection-manager";

export type { DecryptEnvelopeResult, EnvelopeCodecOptions, RoomEnvelope } from "./message-codec";
export { decryptEnvelope, encryptEnvelope, generateRoomKey, importRoomKey } from "./message-codec";

export { isPlausibleRemoteElement, mergeRemoteElement, remoteElementWins } from "./lww-merge";

export type { OutboundSyncDeps } from "./outbound-sync";
export { flushCommentDeltas, flushElementDeltas, sendDocumentSnapshot, sendFullSnapshot, sendPresenceUpdate } from "./outbound-sync";

export type { CollabPagesAdapter, PagesManifest, PagesManifestEntry } from "./pages-adapter";
export type { PageListEntry, PageStoreListener } from "./page-store";
export { PageStore } from "./page-store";
export { createPageStoreCollabAdapter } from "./page-store-adapter";
export { mergeRemoteComments, mergeRemoteCommentMessage, mergeRemoteCommentThread, parseRemoteCommentMessage, parseRemoteCommentThread } from "./comments-adapter";
export { isPlausibleLayersManifest } from "./layers-adapter";
export type { LayersManifest } from "./layers-adapter";
export { isPlausibleManifest, remoteManifestWins } from "./pages-adapter";

export type { InboundMessageDeps } from "./inbound-message-handler";
export { handleInboundMessage } from "./inbound-message-handler";

export type { PresenceListener, PresencePayload, PresenceReaction, PresenceViewport, RemotePeerPresence } from "./presence-state";
export { isPlausiblePresencePayload, MAX_REACTION_EMOJI_LENGTH, PresenceStore, REACTION_EMOJIS, throttle } from "./presence-state";

export type { BuildRoomUrlOptions, ParsedRoomUrl, ParseRoomUrlErrorReason, ParseRoomUrlResult } from "./room-url";
export { buildRoomUrl, buildRoomWebSocketUrl, parseRoomUrl } from "./room-url";
