/**
 * Structural validation for a page's layers manifest arriving off the wire — the layers sibling of
 * `pages-adapter.ts`'s `isPlausibleManifest`, with the same "untrusted data, reject don't trust"
 * policy: a hostile or buggy peer must never empty a scene's layer list (the ≥1 invariant every
 * layer consumer relies on), flood it past the engine's cap, or smuggle non-boolean flags into the
 * hidden/locked predicates that gate rendering and interaction.
 *
 * The manifest rides INSIDE each per-page snapshot entry (`{id, name, elements, layers}`), never as
 * its own wire type — the relay's message whitelist stays untouched, and pre-layers peers simply
 * ignore the unknown key. The LWW win rule and the wholesale-adoption semantics live in the engine
 * (`Scene.applyRemoteLayersManifest`); this module only answers "is this shaped like a manifest?".
 */
import type { LayersManifest } from "@deviva-draw/engine";
import { MAX_LAYERS } from "@deviva-draw/engine";

export type { LayersManifest } from "@deviva-draw/engine";

export function isPlausibleLayersManifest(value: unknown): value is LayersManifest {
  if (typeof value !== "object" || value === null) return false;
  const manifest = value as Record<string, unknown>;
  if (typeof manifest.version !== "number" || !Number.isFinite(manifest.version)) return false;
  if (typeof manifest.versionNonce !== "number" || !Number.isFinite(manifest.versionNonce)) return false;
  if (!Array.isArray(manifest.layers) || manifest.layers.length === 0 || manifest.layers.length > MAX_LAYERS) return false;
  return manifest.layers.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const layer = entry as Record<string, unknown>;
    return typeof layer.id === "string" && layer.id.length > 0 && typeof layer.name === "string" && typeof layer.visible === "boolean" && typeof layer.locked === "boolean";
  });
}
