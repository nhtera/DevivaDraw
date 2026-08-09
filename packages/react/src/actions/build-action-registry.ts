/** Composes every action builder into one populated `ActionRegistry` — the single call `runtime/build-runtime.ts` makes. */
import { ActionRegistry } from "./action-registry";
import { buildArrangeActions } from "./arrange-actions";
import { buildEditActions } from "./edit-actions";
import { buildFileActions } from "./file-actions";
import { buildShareActions } from "./share-actions";
import { buildToolActions } from "./tool-actions";
import { buildViewActions } from "./view-actions";
import { buildZOrderActions } from "./z-order-actions";

export interface BuildActionRegistryOptions {
  /**
   * Whether the "Share" action should be registered at all — gated on the host having configured
   * `shareApiBaseUrl` (see `build-persistence-operations.ts`'s `shareScene`, which would otherwise
   * just reject every time it ran). Defaults to `true` so every existing zero-arg call site (tests,
   * anywhere that doesn't care about this gating) keeps registering it as before; `build-runtime.ts`
   * is the one real caller that passes an explicit value, derived from whether the host configured
   * collaboration/sharing at all.
   */
  shareEnabled?: boolean;
}

export function buildActionRegistry(options: BuildActionRegistryOptions = {}): ActionRegistry {
  const { shareEnabled = true } = options;
  const registry = new ActionRegistry();
  for (const action of [
    ...buildToolActions(),
    ...buildEditActions(),
    ...buildZOrderActions(),
    ...buildArrangeActions(),
    ...buildViewActions(),
    ...buildFileActions(),
    ...(shareEnabled ? buildShareActions() : []),
  ]) {
    registry.register(action);
  }
  return registry;
}
