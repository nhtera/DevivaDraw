/**
 * Duplicate (`Ctrl/Cmd+D`, alt-drag) and internal copy/paste — both funnel through the same
 * "instantiate fresh copies of a set of elements" logic, since duplicating in place and pasting a
 * prior copy are the same operation with a different element source (the live scene vs. a stored
 * snapshot). New elements keep their original `seed` (identical sketchy look — a duplicate should
 * look like the original, not re-roll its rough.js randomness) but get brand-new ids and reset
 * version/z-order bookkeeping, since they're new elements as far as history/collab is concerned.
 *
 * Coherence rules: duplicating a container automatically pulls its bound text along so the pair
 * never separates; an arrow's binding to a shape survives the copy only when that shape was *also*
 * duplicated in the same batch (both remapped to their new ids) — a binding to a shape that stayed
 * behind is dropped rather than kept dangling, since keeping it would leave the new arrow claiming a
 * binding the original shape's own `boundElements` never reciprocates (violating the "no dangling
 * refs, ever" invariant `bindings/binding-model.ts`'s module doc protects).
 * OS clipboard (`navigator.clipboard`) integration is a host/DOM concern (like the system-image paste
 * flow) layered on top of this in-memory store, not implemented here.
 */
import type { BoundElementRef } from "../elements/base-element";
import type { ArrowBinding, ArrowElement } from "../elements/arrow-element";
import type { AnyElement } from "../elements/element-types";
import type { TextElement } from "../elements/text-element";
import type { Scene } from "../scene/scene";

export interface DuplicateOffset {
  dx: number;
  dy: number;
}

/** Default visible offset (scene units) so a duplicate/paste never sits exactly on top of its source. */
export const DEFAULT_DUPLICATE_OFFSET: DuplicateOffset = { dx: 10, dy: 10 };

const MAX_RANDOM_INT = 2 ** 31;

/** Same fallback-safe id scheme as `elements/element-factory-defaults.ts`'s (unexported) `generateElementId` — kept as a small local copy so this module has no dependency on that file's internals. */
function generateCopyId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * MAX_RANDOM_INT).toString(36)}`;
}

/** Expands `ids` to include each selected container's bound text — see the module doc's coherence rule. */
export function expandForDuplication(scene: Scene, ids: readonly string[]): string[] {
  const expanded = new Set(ids);
  for (const id of ids) {
    const textRef = scene.getElement(id)?.boundElements?.find((ref) => ref.type === "text");
    if (textRef) expanded.add(textRef.id);
  }
  return [...expanded];
}

function remapBoundElements(refs: readonly BoundElementRef[] | null, idMap: ReadonlyMap<string, string>): BoundElementRef[] | null {
  if (!refs) return null;
  const remapped = refs.filter((ref) => idMap.has(ref.id)).map((ref) => ({ ...ref, id: idMap.get(ref.id)! }));
  return remapped.length > 0 ? remapped : null;
}

/** Drops a binding to a shape that wasn't duplicated in the same batch — see the module doc. */
function remapBinding(binding: ArrowBinding | null, idMap: ReadonlyMap<string, string>): ArrowBinding | null {
  if (!binding || !idMap.has(binding.elementId)) return null;
  return { ...binding, elementId: idMap.get(binding.elementId)! };
}

function instantiateCopy(original: AnyElement, newId: string, idMap: ReadonlyMap<string, string>, offset: DuplicateOffset): AnyElement {
  const base = {
    ...original,
    id: newId,
    x: original.x + offset.dx,
    y: original.y + offset.dy,
    boundElements: remapBoundElements(original.boundElements, idMap),
    version: 0,
    versionNonce: 0,
    updated: 0,
    index: "",
    isDeleted: false,
  };

  if (original.type === "text") {
    const containerId = original.containerId && idMap.has(original.containerId) ? idMap.get(original.containerId)! : null;
    return { ...base, containerId } as TextElement;
  }
  if (original.type === "arrow") {
    return { ...base, startBinding: remapBinding(original.startBinding, idMap), endBinding: remapBinding(original.endBinding, idMap) } as ArrowElement;
  }
  return base as AnyElement;
}

/** Builds fresh, ready-to-insert copies of `originals`, remapping their mutual references (bound text, arrow bindings) — shared by `duplicateElements` and `InternalClipboard.paste`. */
function instantiateCopies(originals: readonly AnyElement[], offset: DuplicateOffset): AnyElement[] {
  const idMap = new Map<string, string>();
  for (const original of originals) idMap.set(original.id, generateCopyId());
  return originals.map((original) => instantiateCopy(original, idMap.get(original.id)!, idMap, offset));
}

/** Duplicates `ids` (expanded for container/bound-text coherence) in place, offset by `offset`. Returns the new elements' ids. */
export function duplicateElements(scene: Scene, ids: readonly string[], offset: DuplicateOffset = DEFAULT_DUPLICATE_OFFSET): string[] {
  const originals = expandForDuplication(scene, ids)
    .map((id) => scene.getElement(id))
    .filter((element): element is AnyElement => element !== undefined && !element.isDeleted);
  const copies = instantiateCopies(originals, offset);
  for (const copy of copies) scene.addElement(copy);
  return copies.map((copy) => copy.id);
}

/** In-memory "Deviva Draw internal clipboard" — see the module doc for why real OS clipboard MIME I/O lives outside this package. */
export class InternalClipboard {
  private snapshot: AnyElement[] = [];

  /** Snapshots `ids` (expanded for coherence, same as duplicate) as of right now — later scene edits/deletes don't affect a later paste. */
  copy(scene: Scene, ids: readonly string[]): void {
    this.snapshot = expandForDuplication(scene, ids)
      .map((id) => scene.getElement(id))
      .filter((element): element is AnyElement => element !== undefined && !element.isDeleted);
  }

  hasContent(): boolean {
    return this.snapshot.length > 0;
  }

  /** Inserts fresh copies of the last `copy()`'d snapshot into `scene`, offset by `offset`. Returns the new elements' ids ([] if nothing was ever copied). */
  paste(scene: Scene, offset: DuplicateOffset = DEFAULT_DUPLICATE_OFFSET): string[] {
    if (this.snapshot.length === 0) return [];
    const copies = instantiateCopies(this.snapshot, offset);
    for (const copy of copies) scene.addElement(copy);
    return copies.map((copy) => copy.id);
  }
}
