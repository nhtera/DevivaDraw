/**
 * A URL as a scannable code — the phone-in-hand path onto a board, for which copying a URL is no help
 * at all. Shared by the share dialog (a read-only snapshot link) and the collab dialog (a live room).
 *
 * Encoded locally (see `browser/qr-code.ts`): both kinds of URL carry a decryption key in their
 * fragment, so the URL must never reach a third-party renderer to be turned into an image.
 *
 * The one piece of chrome here that ignores the theme, on purpose: the modules are fixed black on a
 * fixed white ground, including the quiet zone. A scanner needs light modules to read as light, so
 * following a dark theme would produce a code that looks right and does not scan. Only the caption
 * below it is themed.
 */
import { useMemo } from "react";
import { encodeQrCodeSvg } from "../browser/qr-code";

export function LinkQrCode(props: { url: string; label: string; testId: string }) {
  const { url, label, testId } = props;
  // Encoding walks the whole module grid, so it is memoized against the URL rather than repeated on
  // every unrelated re-render of the dialog (the copy button's "Copied!" state alone causes several).
  const code = useMemo(() => encodeQrCodeSvg(url), [url]);
  if (!code) return null;

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
      <svg
        data-testid={testId}
        role="img"
        aria-label={label}
        viewBox={`0 0 ${code.size} ${code.size}`}
        width={144}
        height={144}
        style={{ background: "#ffffff", borderRadius: 6, display: "block" }}
      >
        <path d={code.path} fill="#000000" />
      </svg>
      <span style={{ fontSize: 11, color: "var(--dd-text-secondary)" }}>{label}</span>
    </div>
  );
}
