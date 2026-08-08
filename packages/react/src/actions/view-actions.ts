/**
 * View/chrome-toggle actions: zoom, grid, theme, command palette, and the 🟢-priority zen/view-only/
 * stats-panel toggles (gated behind the same `ActionRegistry`/appState pattern
 * as everything else — kept intentionally tiny, no dedicated UI beyond a main-menu toggle each).
 */
import type { Action } from "./action-types";

export function buildViewActions(): Action[] {
  return [
    { id: "zoom-in", labelKey: "action.zoomIn", icon: "zoom-in", shortcut: "meta+=", run: (runtime) => runtime.panZoomTool.zoomStep(1) },
    { id: "zoom-out", labelKey: "action.zoomOut", icon: "zoom-out", shortcut: "meta+-", run: (runtime) => runtime.panZoomTool.zoomStep(-1) },
    { id: "zoom-to-fit", labelKey: "action.zoomToFit", icon: "zoom-fit", shortcut: "shift+1", run: (runtime) => runtime.panZoomTool.zoomToFit() },
    {
      id: "toggle-grid",
      labelKey: "action.toggleGrid",
      icon: "grid",
      run: (runtime) => {
        runtime.grid.enabled = !runtime.grid.enabled;
      },
    },
    { id: "toggle-theme", labelKey: "action.toggleTheme", icon: "theme", run: (runtime) => runtime.theme.toggleMode() },
    {
      id: "open-command-palette",
      labelKey: "action.openCommandPalette",
      icon: "command",
      shortcut: "meta+k",
      run: (runtime) => runtime.ui.setCommandPaletteOpen(true),
    },
    {
      id: "toggle-zen-mode",
      labelKey: "action.toggleZenMode",
      icon: "zen",
      run: (runtime) => runtime.ui.setZenMode(!runtime.ui.getZenMode()),
    },
    {
      id: "toggle-view-only",
      labelKey: "action.toggleViewOnly",
      icon: "view-only",
      run: (runtime) => runtime.ui.setViewOnly(!runtime.ui.getViewOnly()),
    },
    {
      id: "toggle-stats",
      labelKey: "action.toggleStats",
      icon: "stats",
      run: (runtime) => runtime.ui.setStatsPanelVisible(!runtime.ui.getStatsPanelVisible()),
    },
  ];
}
