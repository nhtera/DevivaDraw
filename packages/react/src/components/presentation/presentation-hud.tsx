/**
 * The presentation control bar: slide position, the walk buttons, the reaction bar when a session is
 * live, the notes toggle, and exit.
 *
 * Split out of `presentation-controller.tsx` so that file stays about the camera walk and the keyboard
 * — the two things with real logic in them. This component owns no state: every control reports to the
 * controller, which is where the keyboard reaches the same actions.
 */
import { REACTION_EMOJIS } from "@deviva-draw/collab-client";
import { buttonStyle, panelStyle } from "../chrome-styles";
import { Icon } from "../icon";
import { ReactionBar } from "./presentation-reactions";
import type { Slide } from "./frame-slide-order";
import { useTranslation } from "../../i18n/use-translation";
import type { UseCollabSessionResult } from "../../hooks/use-collab-session";

export interface PresentationHudProps {
  slides: readonly Slide[];
  index: number;
  onGo(delta: number): void;
  notesVisible: boolean;
  onToggleNotes(): void;
  handRaised: boolean;
  onToggleHand(): void;
  /** Present and connected ⇒ the reaction bar is offered; otherwise there is nobody to react to. */
  collab: UseCollabSessionResult | null;
  onExit(): void;
}

export function PresentationHud(props: PresentationHudProps) {
  const { slides, index, onGo, notesVisible, onToggleNotes, handRaised, onToggleHand, collab, onExit } = props;
  const { t } = useTranslation();
  const current = slides[index];

  return (
    <div
      data-testid="presentation-hud"
      style={{
        ...panelStyle,
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        width: "auto",
        height: "auto",
        pointerEvents: "auto",
      }}
    >
      <button type="button" data-testid="presentation-prev" aria-label={t("presentation.previous")} disabled={index === 0} style={buttonStyle(false)} onClick={() => onGo(-1)}>
        <Icon name="chevron-left" />
      </button>
      <span data-testid="presentation-counter" style={{ fontSize: 12, minWidth: 44, textAlign: "center" }}>
        {slides.length === 0 ? "0 / 0" : `${index + 1} / ${slides.length}`}
      </span>
      <button
        type="button"
        data-testid="presentation-next"
        aria-label={t("presentation.next")}
        disabled={slides.length === 0 || index >= slides.length - 1}
        style={buttonStyle(false)}
        onClick={() => onGo(1)}
      >
        <Icon name="chevron-right" />
      </button>
      {current && (
        <span data-testid="presentation-slide-name" style={{ fontSize: 12, color: "var(--dd-text-secondary)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {current.name}
        </span>
      )}
      {collab && (
        <ReactionBar
          emojis={REACTION_EMOJIS}
          handRaised={handRaised}
          onReact={(emoji) => collab.sendReaction(emoji)}
          onToggleHand={onToggleHand}
          reactionLabel={(emoji) => t("presentation.react", { emoji })}
          handLabel={t("presentation.raiseHand")}
        />
      )}
      <button
        type="button"
        data-testid="presentation-notes-toggle"
        aria-label={t("presentation.notes")}
        aria-pressed={notesVisible}
        title={t("presentation.notesHint")}
        style={buttonStyle(notesVisible)}
        onClick={onToggleNotes}
      >
        <Icon name="note" />
      </button>
      <button type="button" data-testid="presentation-exit" aria-label={t("presentation.exit")} title={t("presentation.exit")} style={buttonStyle(false)} onClick={onExit}>
        <Icon name="close" />
      </button>
    </div>
  );
}
