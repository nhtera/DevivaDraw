/**
 * The persistent way out of follow mode: a pill naming the peer whose camera is driving this view.
 *
 * Same reasoning as `exit-zen-pill.tsx` — follow is a mode entered from a dialog that is then closed,
 * and a mode with no visible exit is a trap. It matters more here than in zen: the canvas moving on
 * its own is alarming if nothing on screen says why, and the pan that would normally be the reflex
 * response is precisely what silently ends the mode.
 *
 * Bottom-left, because the zen pill owns bottom-right and the share-viewer badge owns bottom-centre;
 * all three can legitimately be on screen at once.
 */
import { buttonStyle, panelStyle, Z_LAYER } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";

export interface FollowingPeerPillProps {
  /** Display name of the followed peer. */
  peerName: string;
  /** The peer's presence colour, so the pill reads as the same person as their cursor. */
  peerColor: string;
  onStop(): void;
}

export function FollowingPeerPill(props: FollowingPeerPillProps) {
  const { peerName, peerColor, onStop } = props;
  const { t } = useTranslation();
  const label = t("collab.follow.stop");

  return (
    <div style={{ position: "absolute", left: 16, bottom: 16, zIndex: Z_LAYER.menu }}>
      <button
        type="button"
        data-testid="following-peer-pill"
        className="dd-animate-in"
        title={label}
        aria-label={label}
        style={{ ...panelStyle, ...buttonStyle(false), display: "flex", alignItems: "center", gap: 8, width: "auto", height: "auto", padding: "8px 14px", fontSize: 13 }}
        onClick={onStop}
      >
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: peerColor, flexShrink: 0 }} />
        <span>{t("collab.follow.following", { name: peerName })}</span>
        <Icon name="close" size={13} />
      </button>
    </div>
  );
}
