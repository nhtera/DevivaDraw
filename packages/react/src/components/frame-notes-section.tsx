/**
 * Presenter notes for a selected frame — the authoring half of presentation mode's notes strip
 * (`presentation/presenter-notes-panel.tsx` is the reading half).
 *
 * Shown only when the selection is exactly one frame: notes are per-slide prose, so there is no
 * coherent meaning to editing several at once the way a color applies to a whole selection. The
 * textarea is UNCONTROLLED, keyed by frame id — the scene notifies on every remote delta and every
 * unrelated edit, and a controlled value would fight the user's caret mid-sentence. `key` is what
 * makes it reload when the selection moves to a different frame.
 *
 * Commit is on blur, not per keystroke: one history entry per editing session rather than one per
 * character, and one collab delta instead of a stream of them. Cmd/Ctrl+Enter commits without
 * leaving the field; plain Enter inserts a newline, because notes are paragraphs (the divergence
 * from the single-line rename inputs, which commit on Enter).
 *
 * Typed letters do not leak to the tool shortcuts: the shell's key handler already ignores events
 * whose focused element is an input/textarea, so no local `stopPropagation` is needed here.
 */
import { MAX_FRAME_NOTES_LENGTH } from "@deviva-draw/engine";
import type { AnyElement, FrameElement } from "@deviva-draw/engine";
import { inputStyle, labelStyle } from "./chrome-styles";
import { useTranslation } from "../i18n/use-translation";
import type { DevivaRuntime } from "../runtime/runtime-types";

/** The sole selected frame, or `null` when the selection is anything else. */
export function singleSelectedFrame(runtime: DevivaRuntime): FrameElement | null {
  const ids = [...runtime.selection.getSelectedIds()];
  if (ids.length !== 1) return null;
  const element = runtime.scene.getElement(ids[0]!);
  return element && !element.isDeleted && element.type === "frame" ? (element as FrameElement) : null;
}

export function FrameNotesSection(props: { runtime: DevivaRuntime }) {
  const { runtime } = props;
  const { t } = useTranslation();
  const frame = singleSelectedFrame(runtime);
  if (!frame) return null;

  const commit = (raw: string) => {
    const notes = raw.slice(0, MAX_FRAME_NOTES_LENGTH);
    const current = frame.notes ?? "";
    if (notes === current) return;
    runtime.history.beginBatch();
    // Cleared notes drop the field rather than storing `""`, so a frame the user emptied serializes
    // exactly like one that never had notes.
    runtime.scene.updateElement(frame.id, { notes: notes === "" ? undefined : notes } as Partial<AnyElement>);
    runtime.history.endBatch(runtime.scene.getElements());
  };

  return (
    <>
      <span style={labelStyle}>{t("panel.frameNotes")}</span>
      <textarea
        key={frame.id}
        data-testid="frame-notes"
        defaultValue={frame.notes ?? ""}
        maxLength={MAX_FRAME_NOTES_LENGTH}
        rows={3}
        placeholder={t("panel.frameNotesPlaceholder")}
        aria-label={t("panel.frameNotes")}
        // `flexShrink: 0` because the panel is a flex column: without it the textarea is compressed
        // below the height `rows` asked for and clips its own last line.
        style={{ ...inputStyle, resize: "vertical", flexShrink: 0, lineHeight: 1.45, fontFamily: "inherit" }}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) commit((event.target as HTMLTextAreaElement).value);
        }}
      />
    </>
  );
}
