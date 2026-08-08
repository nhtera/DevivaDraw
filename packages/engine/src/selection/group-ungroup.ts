/**
 * Group/ungroup: writes/removes entries in each member's `groupIds` (already on `BaseElement`,
 * "outermost-to-innermost" — see that field's own doc). Grouping selected elements always creates a
 * *new*, outermost group wrapping whatever nesting they already had (prepended to the front of each
 * member's `groupIds`), so grouping an already-grouped subset nests rather than flattens. Ungrouping
 * removes only the outermost group id, one level at a time, so a doubly-nested group ungroups in two
 * explicit steps rather than one that silently flattens everything.
 */
import { randomInt } from "../elements/element-factory-defaults";
import type { Scene } from "../scene/scene";

function generateGroupId(): string {
  return `group-${Date.now().toString(36)}-${randomInt().toString(36)}`;
}

/** Wraps every element in `ids` in a new outermost group. Returns the new group id, or `null` if fewer than 2 elements were given (grouping a single element is meaningless). */
export function groupSelection(scene: Scene, ids: readonly string[]): string | null {
  if (ids.length < 2) return null;
  const groupId = generateGroupId();
  for (const id of ids) {
    const element = scene.getElement(id);
    if (!element || element.isDeleted) continue;
    scene.updateElement(id, { groupIds: [groupId, ...element.groupIds] });
  }
  return groupId;
}

/**
 * Removes each selected element's outermost group id — the group they'd expand to as a unit right
 * now. Elements without any group are left untouched (a mixed selection of grouped + standalone
 * elements ungroups only the grouped ones).
 */
export function ungroupSelection(scene: Scene, ids: readonly string[]): void {
  for (const id of ids) {
    const element = scene.getElement(id);
    if (!element || element.isDeleted || element.groupIds.length === 0) continue;
    scene.updateElement(id, { groupIds: element.groupIds.slice(1) });
  }
}

/**
 * Expands `ids` to every element sharing the outermost group of any grouped member among them — the
 * "clicking one member selects the whole group" rule. Ungrouped ids in the input pass through
 * unchanged. Used by `selection-tool.ts` right after a click/marquee hit resolves a candidate id.
 */
export function expandToGroupMembers(scene: Scene, ids: readonly string[]): string[] {
  const outermostGroupIds = new Set<string>();
  for (const id of ids) {
    const element = scene.getElement(id);
    const outermost = element?.groupIds[0];
    if (outermost) outermostGroupIds.add(outermost);
  }
  if (outermostGroupIds.size === 0) return [...ids];

  const expanded = new Set(ids);
  for (const element of scene.getElements()) {
    if (element.isDeleted) continue;
    const outermost = element.groupIds[0];
    if (outermost && outermostGroupIds.has(outermost)) expanded.add(element.id);
  }
  return [...expanded];
}
