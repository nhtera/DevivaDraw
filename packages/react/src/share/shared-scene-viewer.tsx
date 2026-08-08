/**
 * Standalone, self-contained read-only viewer for a `/s/{blobId}#key=...&iv=...` share link — the
 * counterpart to `<DevivaDraw/>` for the one entry point that has no live scene yet when it mounts.
 * Wraps itself in its own `<LocaleProvider/>`/`<ThemeProvider/>` (same as `deviva-draw-app.tsx`) so its
 * loading/error states are themed/i18n'd consistently with the rest of the chrome, then renders
 * `DevivaDrawShell` directly (not `<DevivaDraw/>`) once a scene is ready — reusing the *same* provider
 * pair rather than nesting a second one. `apps/web`'s `routes/shared-scene-viewer.tsx` is a thin
 * wrapper around this component; every actual concern (fragment parsing, fetch+decrypt, i18n'd error
 * states) lives here, alongside the rest of this package's UI chrome and i18n it's already responsible
 * for (see the module's `README.md`: `apps/web` is "just the browser tab that hosts it").
 */
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { deserializeScene, parseShareUrl } from "@deviva-draw/engine";
import type { SceneDocument } from "@deviva-draw/engine";
import { fetchAndDecryptSharedScene } from "../browser/share-link-client";
import type { FetchSharedSceneErrorReason } from "../browser/share-link-client";
import { DevivaDrawShell } from "../deviva-draw-shell";
import { LocaleProvider, useTranslation } from "../i18n/use-translation";
import type { TranslationKey } from "../i18n/catalog-en";
import type { Locale } from "../i18n/locale-storage";
import { ThemeProvider } from "../theme/theme-provider";
import type { ThemeMode } from "../theme/theme-tokens";

export interface SharedSceneViewerProps {
  /** The collab-server's base URL — the same value the host would pass as `<DevivaDraw shareApiBaseUrl/>`. */
  apiBaseUrl: string;
  theme?: ThemeMode;
  locale?: Locale;
  className?: string;
  style?: CSSProperties;
}

type LoadState = { status: "loading" } | { status: "ready"; document: SceneDocument } | { status: "error"; messageKey: TranslationKey };

/** Maps a fetch/decrypt failure code to its i18n key — kept as a lookup table (not embedded prose) so the network/crypto layer stays free of any user-facing copy. */
const FETCH_ERROR_MESSAGE_KEYS: Record<FetchSharedSceneErrorReason, TranslationKey> = {
  "not-found": "share.error.notFound",
  "network-error": "share.error.network",
  "http-error": "share.error.http",
  "decrypt-failed": "share.error.decrypt",
  "decompress-failed": "share.error.decrypt",
  "invalid-json": "share.error.invalidScene",
};

export function SharedSceneViewer(props: SharedSceneViewerProps) {
  const { apiBaseUrl, theme, locale, className, style } = props;
  return (
    <LocaleProvider locale={locale}>
      <ThemeProvider theme={theme}>
        <SharedSceneViewerBody apiBaseUrl={apiBaseUrl} className={className} style={style} />
      </ThemeProvider>
    </LocaleProvider>
  );
}

function CenteredNotice(props: { children: string; alert?: boolean }) {
  return (
    <div
      role={props.alert ? "alert" : undefined}
      data-testid="shared-scene-viewer-notice"
      style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", fontSize: 14, padding: 24, textAlign: "center" }}
    >
      {props.children}
    </div>
  );
}

function SharedSceneViewerBody(props: { apiBaseUrl: string; className?: string; style?: CSSProperties }) {
  const { apiBaseUrl, className, style } = props;
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    const finish = (next: LoadState) => {
      if (!cancelled) setState(next);
    };

    async function load() {
      const parsed = parseShareUrl(window.location.pathname, window.location.hash);
      if (!parsed.ok) return finish({ status: "error", messageKey: "share.error.invalidLink" });

      const fetched = await fetchAndDecryptSharedScene({ apiBaseUrl, blobId: parsed.value.blobId, keyBase64Url: parsed.value.keyBase64Url, ivBase64Url: parsed.value.ivBase64Url });
      if (!fetched.ok) return finish({ status: "error", messageKey: FETCH_ERROR_MESSAGE_KEYS[fetched.reason] });

      const validated = deserializeScene(fetched.value);
      if (!validated.ok) return finish({ status: "error", messageKey: "share.error.invalidScene" });

      finish({ status: "ready", document: validated.scene.toJSON() });
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [apiBaseUrl]);

  if (state.status === "loading") return <CenteredNotice>{t("share.loading")}</CenteredNotice>;
  if (state.status === "error") return <CenteredNotice alert>{t(state.messageKey)}</CenteredNotice>;
  return <DevivaDrawShell initialData={state.document} initialViewOnly shareApiBaseUrl={apiBaseUrl} className={className} style={style} />;
}
