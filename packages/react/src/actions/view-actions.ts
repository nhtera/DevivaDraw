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
      // Inert while presenting: presentation already owns what chrome is visible, and letting this
      // write the zen flag underneath it would leave the user in zen after exiting, with no idea why.
      isEnabled: (runtime) => !runtime.ui.getPresentationActive(),
      run: (runtime) => runtime.ui.setZenMode(!runtime.ui.getZenMode()),
    },
    {
      id: "toggle-view-only",
      viewOnlyAllowed: true,
      labelKey: "action.toggleViewOnly",
      icon: "view-only",
      shortcut: "alt+r",
      // Inert while presenting, and this one is a correctness requirement rather than a nicety.
      // `ui.getViewOnly()` is DERIVED (the user's own toggle OR presentation), while `setViewOnly`
      // writes only the raw toggle — so running this during a presentation reads `true` from the
      // derived value and writes `false` to the raw one. On a view-only share link that silently
      // converted the board to editable the moment the presentation ended.
      isEnabled: (runtime) => !runtime.ui.getPresentationActive(),
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
      // Not viewer-allowed: the panel's headline control replaces the whole document, and a
      // view-only surface has no business offering it. Deliberately shortcut-less — every other
      // binding here toggles a view, where this one opens a door to replacing the board.
      id: "toggle-version-history",
      labelKey: "action.toggleVersionHistory",
      icon: "history",
      run: (runtime) => runtime.ui.setVersionHistoryOpen(!runtime.ui.getVersionHistoryOpen()),
    },
    {
      // Viewer-allowed, unlike the layers panel: reading a conversation is not editing the document,
      // and a read-only surface still wants the panel (it is the only way to reach a page-anchored or
      // resolved thread). The composer's own gating is the popover's `readOnly` prop.
      id: "toggle-comments",
      viewOnlyAllowed: true,
      labelKey: "action.toggleComments",
      icon: "comment",
      shortcut: "alt+c",
      run: (runtime) => runtime.ui.setCommentsPanelVisible(!runtime.ui.getCommentsPanelVisible()),
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
      // View-only-allowed: presenting is the most read-only thing the app does — it *enters*
      // view-only itself. Enabled only with at least one frame, since frames are the slides.
      id: "present",
      viewOnlyAllowed: true,
      labelKey: "action.present",
      icon: "present",
      isEnabled: (runtime) => runtime.scene.getElements().some((element) => element.type === "frame" && !element.isDeleted),
      run: (runtime) => runtime.ui.setPresentationActive(true),
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
