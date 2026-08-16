/**
 * TEST DOUBLE ONLY (excluded from the published package): a minimal in-memory relay standing in
 * for `apps/collab-server`'s Durable Object room — the same harness pattern collab-client's own
 * suite uses. Faithful enough to exercise the bridge's full wire path (encryption, snapshots,
 * presence, LWW merge) with zero network; the real relay's behavior is covered by
 * `apps/collab-server`'s own tests and Phase 2's wrangler-dev integration test.
 */
import type { WebSocketLike } from "@deviva-draw/collab-client";

export class FakeCollabRelay {
  private readonly members: Array<{ peerId: string; socket: FakeSocket }> = [];
  private storedSnapshot: string | null = null;
  private nextPeerId = 1;

  createSocket(): FakeSocket {
    const peerId = `peer-${this.nextPeerId++}`;
    const socket = new FakeSocket((raw) => this.handleMessage(peerId, socket, raw));
    this.members.push({ peerId, socket });
    queueMicrotask(() => socket.open());
    return socket;
  }

  private handleMessage(senderId: string, senderSocket: FakeSocket, raw: string): void {
    const message = JSON.parse(raw) as { type: string };
    if (message.type === "snapshot-request") {
      if (this.storedSnapshot) senderSocket.deliver(this.storedSnapshot);
      else this.broadcastExceptSender(senderId, raw);
      return;
    }
    if (message.type === "snapshot") this.storedSnapshot = JSON.stringify({ ...message, peerId: senderId });
    this.broadcastExceptSender(senderId, JSON.stringify({ ...message, peerId: senderId }));
  }

  private broadcastExceptSender(senderId: string, raw: string): void {
    for (const member of this.members) {
      if (member.peerId !== senderId) member.socket.deliver(raw);
    }
  }
}

export class FakeSocket implements WebSocketLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(private readonly onSend: (raw: string) => void) {}

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  deliver(raw: string): void {
    this.onmessage?.({ data: raw });
  }

  send(data: string): void {
    this.onSend(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.({ code: 1000 });
  }
}

/** Polls `condition` (sync or async) until true or timeout — the async encrypt/decrypt + debounce pipeline makes fixed sleeps brittle. */
export async function waitUntil(condition: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil: timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
