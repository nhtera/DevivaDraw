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
 * refs, ever" invariant `bindings/binding-model.ts`'s module doc protects). Group membership is
 * likewise re-minted rather than copied: `group-ungroup.ts`'s `expandToGroupMembers` resolves a group
 * by scanning the *whole scene* for a shared outermost `groupIds[0]`, so carrying the source's group
 * ids over would silently fuse a copy into its original — clicking either one would then select both.
 * OS clipboard (`navigator.clipboard`) integration is a host/DOM concern (like the system-image paste
 * flow) layered on top of this in-memory store, not implemented here.
 */
import type { BoundElementRef } from "../elements/base-element";
import type { ArrowBinding, ArrowElement } from "../elements/arrow-element";
import type { AnyElement } from "../elements/element-types";
import type { TableElement } from "../elements/table-element";
import { tableCellsGrid, tableColumnWidths, tableRowHeights } from "../elements/table-layout";
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

/**
 * Fresh group ids for the copies, keeping nesting intact: every occurrence of one source group id
 * maps to the same new id, so a nested group stays nested and members stay together — they just no
 * longer share an identity with the originals. Group ids not present in the batch never appear here,
 * so a partially-copied group detaches from its source rather than half-joining it.
 */
function remapGroupIds(groupIds: readonly string[], groupIdMap: ReadonlyMap<string, string>): string[] {
  return groupIds.map((groupId) => groupIdMap.get(groupId) ?? groupId);
}

function instantiateCopy(
  original: AnyElement,
  newId: string,
  idMap: ReadonlyMap<string, string>,
  groupIdMap: ReadonlyMap<string, string>,
  offset: DuplicateOffset,
): AnyElement {
  const base = {
    ...original,
    id: newId,
    x: original.x + offset.dx,
    y: original.y + offset.dy,
    groupIds: remapGroupIds(original.groupIds, groupIdMap),
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
  if (original.type === "table") {
    // The top-level spread shares nested arrays by reference — fine for immutably-replaced fields,
    // but a table's grid is exactly the kind of nested structure an in-place edit would silently
    // corrupt across copy and original. Rebuild all three through table-layout's defensive readers
    // (never the stored arrays raw — a collab-ingested malformed grid must degrade, not crash the
    // duplicate/paste path), the `groupIds`/`boundElements` fresh-array precedent.
    return {
      ...base,
      columnWidths: tableColumnWidths(original),
      rowHeights: tableRowHeights(original),
      cells: tableCellsGrid(original),
    } as TableElement;
  }
  return base as AnyElement;
}

/** Builds fresh, ready-to-insert copies of `originals`, remapping their mutual references (bound text, arrow bindings, group membership) — shared by `duplicateElements` and `InternalClipboard.paste`. */
function instantiateCopies(originals: readonly AnyElement[], offset: DuplicateOffset): AnyElement[] {
  const idMap = new Map<string, string>();
  const groupIdMap = new Map<string, string>();
  for (const original of originals) {
    idMap.set(original.id, generateCopyId());
    for (const groupId of original.groupIds) {
      if (!groupIdMap.has(groupId)) groupIdMap.set(groupId, generateCopyId());
    }
  }
  return originals.map((original) => instantiateCopy(original, idMap.get(original.id)!, idMap, groupIdMap, offset));
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

/**
 * Inserts fresh copies of externally-provided `elements` (e.g. a saved library item loaded from
 * localStorage) into `scene`, remapping their mutual references exactly like paste/duplicate. Unlike
 * `paste`, the source isn't a prior in-scene copy, so the caller supplies the elements directly and
 * picks the offset (typically computed to drop them at the viewport center). Returns the new ids.
 */
export function insertElements(scene: Scene, elements: readonly AnyElement[], offset: DuplicateOffset = { dx: 0, dy: 0 }): string[] {
  const copies = instantiateCopies(elements, offset);
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
