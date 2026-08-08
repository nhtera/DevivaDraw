/**
 * Shared "fill in every `BaseElement` default" builder used by every concrete element factory
 * (`createGenericElement`, `createRectangleElement`, ...). Centralized here — instead of repeating
 * the same field-defaulting logic per shape type — so every element factory produces consistent
 * defaults and a change to one (e.g. a new default stroke color) never needs hunting across N
 * factory functions.
 */
import type { BaseElement } from "./base-element";

/**
 * Caller-supplied fields for creating a new element. Everything the store itself must own
 * (`version`, `versionNonce`, `updated`, `index`) is excluded — those are only ever set by
 * `Scene`'s mutation path (see `scene/scene-mutations.ts`) so the version/nonce invariant can
 * never be bypassed by constructing an element directly.
 */
export type ElementCreationInput = Partial<
  Omit<BaseElement, "id" | "type" | "version" | "versionNonce" | "updated" | "index">
> & {
  x: number;
  y: number;
};

/** Upper bound for `seed`/`versionNonce` — comfortably inside `Number.isSafeInteger` after arithmetic on it. */
const MAX_RANDOM_INT = 2 ** 31;

/** Cryptographically-insignificant random int: only needs to be unlikely to collide, not secure. */
export function randomInt(): number {
  return Math.floor(Math.random() * MAX_RANDOM_INT);
}

function generateElementId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for runtimes without Web Crypto (kept pure-JS so the engine has zero required deps
  // beyond fractional-indexing/roughjs); collision risk is negligible for a single local session.
  return `${Date.now().toString(36)}-${randomInt().toString(36)}`;
}

/**
 * Builds every `BaseElement` field except `type` (the caller's discriminant) and the store-owned
 * store-owned fields are left at pre-insert sentinel values (`version: 0`, `versionNonce: 0`,
 * `updated: 0`, `index: ""`) rather than omitted: `touch()` computes `element.version + 1`, so a
 * fresh element must already have a numeric `version` for the very first `Scene.addElement()` call
 * to produce `version === 1` instead of `NaN`. `Scene.addElement`/`updateElement` (via `touch()`,
 * see `scene/scene-mutations.ts`) are the only places that ever advance these fields afterward.
 * Every concrete `create*Element` factory spreads this and adds its own `type` (plus, for shapes
 * with extra geometry like `LineElement.points`, those fields too).
 */
export function createElementBase(input: ElementCreationInput): Omit<BaseElement, "type"> {
  return {
    id: generateElementId(),
    x: input.x,
    y: input.y,
    width: input.width ?? 0,
    height: input.height ?? 0,
    angle: input.angle ?? 0,
    strokeColor: input.strokeColor ?? "#1e1e1e",
    backgroundColor: input.backgroundColor ?? "transparent",
    fillStyle: input.fillStyle ?? "solid",
    strokeWidth: input.strokeWidth ?? 1,
    strokeStyle: input.strokeStyle ?? "solid",
    roughness: input.roughness ?? 1,
    opacity: input.opacity ?? 100,
    roundness: input.roundness ?? null,
    seed: input.seed ?? randomInt(),
    groupIds: input.groupIds ?? [],
    frameId: input.frameId ?? null,
    boundElements: input.boundElements ?? null,
    link: input.link ?? null,
    locked: input.locked ?? false,
    index: "",
    version: 0,
    versionNonce: 0,
    updated: 0,
    isDeleted: input.isDeleted ?? false,
  };
}
