/** File/persistence/export actions — thin dispatchers to `runtime.persistence`'s browser-facing operations (see `browser/persistence-adapters.ts`). */
import type { Action } from "./action-types";

export function buildFileActions(): Action[] {
  return [
    { id: "new-scene", labelKey: "action.newScene", icon: "file", run: (runtime) => runtime.persistence.newScene() },
    { id: "open-scene", labelKey: "action.openScene", icon: "folder-open", run: (runtime) => runtime.persistence.openScene() },
    { id: "save-scene", labelKey: "action.saveScene", icon: "save", run: (runtime) => runtime.persistence.saveScene(), viewOnlyAllowed: true },
    { id: "export-png", labelKey: "action.exportPng", icon: "export-png", run: (runtime) => runtime.persistence.exportPng(), viewOnlyAllowed: true },
    { id: "export-svg", labelKey: "action.exportSvg", icon: "export-svg", run: (runtime) => runtime.persistence.exportSvg(), viewOnlyAllowed: true },
    { id: "copy-as-image", labelKey: "action.copyAsImage", icon: "copy-image", run: (runtime) => runtime.persistence.copyAsImage(), viewOnlyAllowed: true },
    { id: "copy-as-svg", labelKey: "action.copyAsSvg", icon: "export-svg", run: (runtime) => runtime.persistence.copyAsSvg(), viewOnlyAllowed: true },
  ];
}
