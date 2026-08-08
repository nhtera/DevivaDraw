/**
 * The concrete element union and its factory functions.
 *
 * Only a `generic` placeholder element exists this phase — enough to exercise the scene store
 * and history stack end to end. Concrete shapes (rectangle, ellipse, text, arrow, freedraw,
 * image, ...) are added incrementally in later phases as thin `extends BaseElement` members
 * appended to `AnyElement`, each with its own `create*Element` factory following this same shape.
 */
import type { BaseElement } from "./base-element";

/** Stand-in element used until concrete shape types land; carries no extra fields beyond the base. */
export interface GenericElement extends BaseElement {
  type: "generic";
}

export type AnyElement = GenericElement;

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

function randomInt(): number {
  return Math.floor(Math.random() * MAX_RANDOM_INT);
}

function generateElementId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for runtimes without Web Crypto (kept pure-JS so the engine has zero required deps
  // beyond fractional-indexing); collision risk is negligible for a single local session.
  return `${Date.now().toString(36)}-${randomInt().toString(36)}`;
}

/**
 * Builds a new `GenericElement` with sane defaults for every field the caller did not supply.
 *
 * The returned element is *not yet* store-tracked: `version`/`versionNonce`/`updated` are left at
 * their zero-value sentinels and `index` is empty. `Scene.addElement` is the only place that
 * assigns real values for those fields, via `touch()` — see `scene/scene-mutations.ts` for why
 * that invariant is centralized there instead of here.
 */
export function createGenericElement(input: ElementCreationInput): GenericElement {
  return {
    id: generateElementId(),
    type: "generic",
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
