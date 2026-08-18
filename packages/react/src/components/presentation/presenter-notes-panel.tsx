/**
 * The presenter's notes strip: the current slide's `FrameElement.notes`, readable while presenting.
 *
 * Sits above the HUD in the same overlay and is the ONLY place notes are ever drawn — never on
 * canvas — which is what makes them the presenter's and not the audience's. That protection is
 * screen-scoped, not identity-scoped: anyone looking at this screen (a mirrored projector, a shared
 * tab) sees them. A separate presenter window is what would fix that, and is out of scope.
 *
 * Toggled rather than always-on, and hidden by default: a deck whose frames carry no notes should
 * cost no stage space, and a presenter who wants the clean view should be able to get it back.
 */
import { panelStyle, Z_LAYER } from "../chrome-styles";

/**
 * `emptyLabel` rather than rendering nothing when this slide has no notes: the strip is a toggle, and
 * a toggle that produces no visible change on a note-less slide reads as broken rather than as empty.
 */
export function PresenterNotesPanel(props: { notes: string; label: string; emptyLabel: string }) {
  const { notes, label, emptyLabel } = props;
  const isEmpty = notes.trim() === "";
  return (
    <div
      data-testid="presenter-notes"
      aria-label={label}
      style={{
        ...panelStyle,
        position: "absolute",
        bottom: 74,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(680px, calc(100vw - 32px))",
        height: "auto",
        maxHeight: "26vh",
        overflowY: "auto",
        padding: "10px 14px",
        pointerEvents: "auto",
        zIndex: Z_LAYER.menu,
        fontSize: 13,
        lineHeight: 1.5,
        // Notes are authored as paragraphs; without this every line break the presenter typed would
        // collapse and the strip would read as one run-on block at exactly the wrong moment.
        whiteSpace: "pre-wrap",
        textAlign: "left",
        ...(isEmpty ? { color: "var(--dd-text-secondary)", fontStyle: "italic" } : null),
      }}
    >
      {isEmpty ? emptyLabel : notes}
    </div>
  );
}
