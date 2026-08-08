/** Composes every action builder into one populated `ActionRegistry` — the single call `runtime/build-runtime.ts` makes. */
import { ActionRegistry } from "./action-registry";
import { buildArrangeActions } from "./arrange-actions";
import { buildEditActions } from "./edit-actions";
import { buildFileActions } from "./file-actions";
import { buildToolActions } from "./tool-actions";
import { buildViewActions } from "./view-actions";
import { buildZOrderActions } from "./z-order-actions";

export function buildActionRegistry(): ActionRegistry {
  const registry = new ActionRegistry();
  for (const action of [
    ...buildToolActions(),
    ...buildEditActions(),
    ...buildZOrderActions(),
    ...buildArrangeActions(),
    ...buildViewActions(),
    ...buildFileActions(),
  ]) {
    registry.register(action);
  }
  return registry;
}
