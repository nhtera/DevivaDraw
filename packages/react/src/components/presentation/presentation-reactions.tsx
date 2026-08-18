/**
 * Audience reactions while presenting: the floating emoji layer everyone sees, and the bar the local
 * peer sends from.
 *
 * Scoped to presentation mode on purpose. Reactions are feedback on something being SHOWN — a stream
 * of emoji over an ordinary editing session would be noise, and the raised hand only means anything
 * when there is someone presenting to notice it.
 *
 * A reaction animates from the sender's last known cursor, converted to screen space through the live
 * presentation camera. A peer with no cursor on this page has no position to animate from, so theirs
 * rises from the bottom edge instead of being dropped — the reaction still carries who sent it, which
 * is most of its meaning.
 */
import { sceneToScreen } from "@deviva-draw/engine";
import type { Camera } from "@deviva-draw/engine";
import type { RemotePeerPresence } from "@deviva-draw/collab-client";
import { buttonStyle, panelStyle, Z_LAYER } from "../chrome-styles";
import { REACTION_LIFETIME_MS } from "../../hooks/use-peer-reactions";
import type { FloatingReaction } from "../../hooks/use-peer-reactions";

export function FloatingReactions(props: { reactions: readonly FloatingReaction[]; camera: Camera; viewport: { width: number; height: number } }) {
  const { reactions, camera, viewport } = props;
  if (reactions.length === 0) return null;

  return (
    <div data-testid="presentation-reactions" style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: Z_LAYER.menu }}>
      {reactions.map((reaction) => {
        const screen = reaction.point ? sceneToScreen(reaction.point, camera) : { x: viewport.width / 2, y: viewport.height - 120 };
        return (
          <div
            key={reaction.key}
            className="dd-reaction"
            data-testid="presentation-reaction"
            style={{
              position: "absolute",
              // Clamped into the viewport so a reaction from a peer looking somewhere far off-screen
              // still shows up rather than animating in a region nobody can see.
              left: Math.min(Math.max(24, screen.x), Math.max(24, viewport.width - 24)),
              top: Math.min(Math.max(48, screen.y), Math.max(48, viewport.height - 48)),
              display: "flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
              ["--dd-reaction-lifetime" as string]: `${REACTION_LIFETIME_MS}ms`,
            }}
          >
            <span style={{ fontSize: 30, lineHeight: 1 }}>{reaction.emoji}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: reaction.color, textShadow: "0 1px 3px rgba(0,0,0,0.45)" }}>{reaction.name}</span>
          </div>
        );
      })}
    </div>
  );
}

export interface ReactionBarProps {
  emojis: readonly string[];
  handRaised: boolean;
  onReact(emoji: string): void;
  onToggleHand(): void;
  reactionLabel(emoji: string): string;
  handLabel: string;
}

/** The send side, rendered inside the presentation HUD row. */
export function ReactionBar(props: ReactionBarProps) {
  const { emojis, handRaised, onReact, onToggleHand, reactionLabel, handLabel } = props;
  return (
    <>
      {emojis.map((emoji) => (
        <button
          key={emoji}
          type="button"
          data-testid={`presentation-react-${emoji}`}
          aria-label={reactionLabel(emoji)}
          title={reactionLabel(emoji)}
          style={{ ...buttonStyle(false), fontSize: 16, padding: "2px 5px" }}
          onClick={() => onReact(emoji)}
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        data-testid="presentation-raise-hand"
        aria-label={handLabel}
        aria-pressed={handRaised}
        title={handLabel}
        style={{ ...buttonStyle(handRaised), fontSize: 16, padding: "2px 5px" }}
        onClick={onToggleHand}
      >
        ✋
      </button>
    </>
  );
}

/** Who is asking to speak — shown to whoever is driving the deck, above the HUD. */
export function RaisedHandsList(props: { peers: readonly RemotePeerPresence[]; label: string }) {
  const { peers, label } = props;
  if (peers.length === 0) return null;
  return (
    <div
      data-testid="presentation-raised-hands"
      aria-label={label}
      style={{ ...panelStyle, position: "absolute", top: 16, right: 16, width: "auto", height: "auto", padding: "8px 12px", pointerEvents: "auto", fontSize: 12, textAlign: "left" }}
    >
      <div style={{ color: "var(--dd-text-secondary)", marginBottom: 4 }}>{label}</div>
      {peers.map((peer) => (
        <div key={peer.peerId} data-testid="presentation-raised-hand-peer" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span aria-hidden>✋</span>
          <span style={{ color: peer.color, fontWeight: 600 }}>{peer.name}</span>
        </div>
      ))}
    </div>
  );
}
