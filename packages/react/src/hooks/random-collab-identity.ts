/**
 * A default display name/color for a collaborator who hasn't set one explicitly — generated once per
 * mounted session so cursors/presence still have something readable to show without forcing every
 * embedder to collect a profile name before collaboration works. Deliberately not persisted/configurable
 * here (YAGNI for V1): a future "set your name" UI would just pass an explicit identity into
 * `useCollabSession` instead of relying on this generator.
 */
const GUEST_NAME_MIN = 1000;
const GUEST_NAME_MAX = 9999;

export function randomGuestName(): string {
  const suffix = Math.floor(Math.random() * (GUEST_NAME_MAX - GUEST_NAME_MIN + 1)) + GUEST_NAME_MIN;
  return `Guest ${suffix}`;
}

/** A small fixed palette (not fully random RGB) so every generated color stays legible against both light and dark chrome themes — an arbitrary random hue could land unreadably close to either background. */
const GUEST_COLOR_PALETTE = ["#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5", "#0c8599", "#e8590c", "#ae3ec9"];

export function randomGuestColor(): string {
  const index = Math.floor(Math.random() * GUEST_COLOR_PALETTE.length);
  return GUEST_COLOR_PALETTE[index]!;
}
