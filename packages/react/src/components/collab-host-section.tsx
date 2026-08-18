/**
 * The "host this room on your own network" half of the collaboration dialog.
 *
 * Rendered only when the embedding application supplies a hosting capability — the desktop app does,
 * the web build does not — so this is never a disabled control explaining why it is disabled. A
 * feature a page structurally cannot perform is better absent than greyed out.
 *
 * Two things are stated up front rather than discovered as failures: which network the room will be
 * published on (a laptop usually has more than one, and picking wrong produces a link that looks fine
 * and reaches nobody), and that peers join from the desktop app. That second one is not a limitation
 * this dialog can design away — a browser refuses an unencrypted socket from an encrypted page — so
 * saying it plainly is the whole remedy.
 */
import { useEffect, useState } from "react";
import { buttonStyle, inputStyle, labelStyle } from "./chrome-styles";
import type { TranslationKey } from "../i18n/catalog-en";
import { useTranslation } from "../i18n/use-translation";
import { DEFAULT_LAN_PORT } from "../browser/lan-host-controller";
import type { LanHostErrorReason } from "../browser/lan-host-controller";
import type { UseLanHostingResult } from "../hooks/use-lan-hosting";

const HOST_ERROR_KEY: Record<LanHostErrorReason, TranslationKey> = {
  "already-hosting": "collab.host.error.alreadyHosting",
  "port-in-use": "collab.host.error.portInUse",
  "permission-denied": "collab.host.error.permissionDenied",
  "no-network": "collab.host.error.noNetwork",
  "start-failed": "collab.host.error.startFailed",
};

export function CollabHostSection(props: { hosting: UseLanHostingResult }) {
  const { hosting } = props;
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  // Kept as text, not a number: a half-typed port is a legitimate intermediate state, and a numeric
  // input that silently coerces "" to 0 would try to bind port 0 the moment somebody clears it.
  const [port, setPort] = useState(String(DEFAULT_LAN_PORT));

  // A laptop's addresses change without announcing it (docking, Wi-Fi switch), so they are read when
  // this section appears rather than once at mount of something longer-lived.
  useEffect(() => {
    void hosting.refresh();
  }, [hosting.refresh]);

  const address = selected ?? hosting.addresses[0]?.address ?? null;

  const parsedPort = /^\d{1,5}$/.test(port) ? Number(port) : null;
  const portValid = parsedPort !== null && parsedPort >= 1024 && parsedPort <= 65535;

  const startHosting = async () => {
    if (!address || !portValid) return;
    setStarting(true);
    await hosting.start(address, parsedPort);
    setStarting(false);
  };

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--dd-border)" }} data-testid="collab-host-section">
      <strong style={{ fontSize: 13 }}>{t("collab.host.title")}</strong>
      <p style={{ ...labelStyle, marginTop: 4 }}>{t("collab.host.description")}</p>

      {hosting.error && (
        <p role="alert" data-testid="collab-host-error" style={{ fontSize: 12 }}>
          {t(HOST_ERROR_KEY[hosting.error])}
        </p>
      )}

      {!hosting.addressesRead ? null : hosting.addresses.length === 0 ? (
        <p role="status" data-testid="collab-host-no-network" style={{ fontSize: 12, color: "var(--dd-text-secondary)" }}>
          {t("collab.host.error.noNetwork")}
        </p>
      ) : (
        <>
          {/* Shown only when the choice is real. One address is not a decision worth a control. */}
          {hosting.addresses.length > 1 && (
            <>
              <label style={labelStyle} htmlFor="collab-host-address">
                {t("collab.host.addressLabel")}
              </label>
              <select
                id="collab-host-address"
                value={address ?? ""}
                onChange={(event) => setSelected(event.target.value)}
                style={inputStyle}
                data-testid="collab-host-address"
              >
                {hosting.addresses.map((candidate) => (
                  <option key={candidate.address} value={candidate.address}>
                    {candidate.interface} — {candidate.address}
                  </option>
                ))}
              </select>
            </>
          )}
          {/* A port field, because "that port is in use" is an error this dialog can otherwise show
              with no way to act on it. Below 1024 needs privileges this app does not have. */}
          <label style={labelStyle} htmlFor="collab-host-port">
            {t("collab.host.portLabel")}
          </label>
          <input
            id="collab-host-port"
            type="text"
            inputMode="numeric"
            value={port}
            onChange={(event) => setPort(event.target.value.trim())}
            style={{ ...inputStyle, width: 110 }}
            aria-invalid={!portValid}
            data-testid="collab-host-port"
          />
          <button type="button" style={{ ...buttonStyle(false), width: "auto", height: "auto", padding: "6px 12px", marginTop: 8 }} disabled={starting || !portValid} onClick={() => void startHosting()} data-testid="collab-host-start">
            {t(starting ? "collab.host.starting" : "collab.host.start")}
          </button>
        </>
      )}

      <p style={{ ...labelStyle, marginTop: 8 }}>{t("collab.host.desktopOnly")}</p>
    </div>
  );
}
