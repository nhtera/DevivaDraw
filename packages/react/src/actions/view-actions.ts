/**
 * View/chrome-toggle actions: zoom, grid, theme, command palette, and the 🟢-priority zen/view-only/
 * stats-panel toggles (gated behind the same `ActionRegistry`/appState pattern
 * as everything else — kept intentionally tiny, no dedicated UI beyond a main-menu toggle each).
 */
import { selectionBoundsOf } from "@deviva-draw/engine";
import type { SelectOnMode } from "@deviva-draw/engine";
import { getEditorPreferences, setEditorPreferences } from "../browser/editor-preferences";
import { writeStoredGrid } from "../preferences/grid-storage";
import { writeStoredObjectSnap } from "../preferences/object-snap-storage";
import type { Action, ActionRuntime } from "./action-types";

/** The order the palette entry steps through — same order the menu's segmented control renders. */
const SELECT_ON_MODES: readonly SelectOnMode[] = ["auto", "wrap", "overlap"];

/** Rotation-aware bounds of the current selection, or `null` when nothing is selected. */
function selectedBounds(runtime: ActionRuntime) {
  const ids = runtime.selection.getSelectedIds();
  if (ids.size === 0) return null;
  return selectionBoundsOf(runtime.scene.getElements().filter((element) => !element.isDeleted && ids.has(element.id)));
}

export function buildViewActions(): Action[] {
  return [
    { id: "zoom-in", labelKey: "action.zoomIn", icon: "zoom-in", shortcut: "meta+=", run: (runtime) => runtime.panZoomTool.zoomStep(1), viewOnlyAllowed: true },
    { id: "zoom-out", labelKey: "action.zoomOut", icon: "zoom-out", shortcut: "meta+-", run: (runtime) => runtime.panZoomTool.zoomStep(-1), viewOnlyAllowed: true },
    { id: "zoom-to-fit", labelKey: "action.zoomToFit", icon: "zoom-fit", shortcut: "shift+1", run: (runtime) => runtime.panZoomTool.zoomToFit(), viewOnlyAllowed: true },
    {
      id: "zoom-to-selection",
      labelKey: "action.zoomToSelection",
      icon: "zoom-fit",
      shortcut: "shift+2",
      isEnabled: (runtime) => runtime.selection.getSelectedIds().size > 0,
      run: (runtime) => runtime.panZoomTool.zoomToBounds(selectedBounds(runtime)),
    },
    { id: "zoom-reset", labelKey: "action.zoomReset", icon: "zoom-in", shortcut: "shift+0", run: (runtime) => runtime.panZoomTool.resetZoom(), viewOnlyAllowed: true },
    {
      id: "toggle-grid",
      viewOnlyAllowed: true,
      labelKey: "action.toggleGrid",
      icon: "grid",
      shortcut: "meta+'",
      run: (runtime) => {
        runtime.grid.enabled = !runtime.grid.enabled;
        try {
          if (typeof window !== "undefined") writeStoredGrid(window.localStorage, runtime.grid.enabled);
        } catch {
          // Same policy as the snap toggle below: blocked storage costs only the cross-reload memory.
        }
      },
    },
    {
      id: "toggle-object-snap",
      labelKey: "action.toggleObjectSnap",
      icon: "snap",
      // Alt+S, the shortcut Excalidraw uses for the same preference.
      shortcut: "alt+s",
      run: (runtime) => {
        runtime.objectSnap.enabled = !runtime.objectSnap.enabled;
        try {
          if (typeof window !== "undefined") writeStoredObjectSnap(window.localStorage, runtime.objectSnap.enabled);
        } catch {
          // A blocked-storage policy costs the preference its memory across reloads, never the toggle itself.
        }
      },
    },
    { id: "toggle-theme", labelKey: "action.toggleTheme", icon: "theme", run: (runtime) => runtime.theme.toggleMode(), viewOnlyAllowed: true },
    {
      id: "open-command-palette",
      viewOnlyAllowed: true,
      labelKey: "action.openCommandPalette",
      icon: "command",
      shortcut: "meta+k",
      run: (runtime) => runtime.ui.setCommandPaletteOpen(true),
    },
    {
      id: "toggle-zen-mode",
      viewOnlyAllowed: true,
      labelKey: "action.toggleZenMode",
      icon: "zen",
      shortcut: "alt+z",
      run: (runtime) => runtime.ui.setZenMode(!runtime.ui.getZenMode()),
    },
    {
      id: "toggle-view-only",
      viewOnlyAllowed: true,
      labelKey: "action.toggleViewOnly",
      icon: "view-only",
      shortcut: "alt+r",
      run: (runtime) => runtime.ui.setViewOnly(!runtime.ui.getViewOnly()),
    },
    {
      // View-only-allowed unlike the layers/stats panels below: hiding or showing the properties
      // panel changes nothing about the document, and view-only unmounts the panel regardless — so
      // the toggle only decides what the user sees once they leave view-only.
      id: "toggle-properties-panel",
      viewOnlyAllowed: true,
      labelKey: "action.togglePropertiesPanel",
      icon: "sliders",
      shortcut: "alt+/",
      run: (runtime) => runtime.ui.setPropertiesPanelVisible(!runtime.ui.getPropertiesPanelVisible()),
    },
    {
      // Not view-only-allowed: the lock only governs what happens after a *creation* tool draws
      // something, and creation tools are exactly what view-only forbids.
      id: "toggle-tool-lock",
      labelKey: "action.toggleToolLock",
      icon: "lock",
      shortcut: "q",
      run: (runtime) => runtime.ui.setToolLocked(!runtime.ui.getToolLocked()),
    },
    {
      // Deliberately NOT viewOnlyAllowed even though it's "just a panel toggle": every control the
      // panel exposes mutates the document, and view-only unmounts the panel anyway.
      id: "toggle-layers",
      labelKey: "action.toggleLayers",
      icon: "layers",
      run: (runtime) => runtime.ui.setLayersPanelVisible(!runtime.ui.getLayersPanelVisible()),
    },
    {
      id: "toggle-minimap",
      viewOnlyAllowed: true,
      labelKey: "action.toggleMinimap",
      icon: "minimap",
      run: (runtime) => runtime.ui.setMinimapVisible(!runtime.ui.getMinimapVisible()),
    },
    // The three editor-behavior preferences. None is view-only-allowed: each governs an editing
    // gesture (marquee, arrow creation, endpoint drag) that view-only forbids outright. They read
    // and write the `browser/editor-preferences.ts` store rather than `runtime.ui`, because the
    // engine consumes them through plain getters threaded into tool deps, not through React state.
    {
      id: "cycle-select-on-mode",
      labelKey: "action.cycleSelectOnMode",
      icon: "select-all",
      run: () => {
        const index = SELECT_ON_MODES.indexOf(getEditorPreferences().selectOnMode);
        setEditorPreferences({ selectOnMode: SELECT_ON_MODES[(index + 1) % SELECT_ON_MODES.length]! });
      },
    },
    {
      id: "toggle-arrow-binding",
      labelKey: "action.toggleArrowBinding",
      icon: "arrow",
      run: () => setEditorPreferences({ arrowBinding: !getEditorPreferences().arrowBinding }),
    },
    {
      id: "toggle-snap-midpoints",
      labelKey: "action.toggleSnapMidpoints",
      icon: "snap",
      run: () => setEditorPreferences({ snapMidpoints: !getEditorPreferences().snapMidpoints }),
    },
    {
      id: "toggle-constant-width-pen",
      labelKey: "action.toggleConstantWidthPen",
      icon: "pencil",
      run: () => setEditorPreferences({ constantWidthPen: !getEditorPreferences().constantWidthPen }),
    },
    {
      // Not view-only-allowed: the stats panel's editable fields write straight to the scene.
      id: "toggle-stats",
      labelKey: "action.toggleStats",
      icon: "stats",
      run: (runtime) => runtime.ui.setStatsPanelVisible(!runtime.ui.getStatsPanelVisible()),
    },
  ];
}
