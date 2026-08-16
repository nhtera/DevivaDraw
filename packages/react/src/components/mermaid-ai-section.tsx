/**
 * The "text to diagram" strip at the top of the Mermaid dialog: describe the diagram in plain
 * language, Generate fills the Mermaid source editor below via the user's own API key
 * (`browser/ai-text-to-diagram.ts`) — from there the normal preview/insert flow takes over, so a
 * generated diagram can be hand-tweaked before inserting exactly like a pasted one.
 *
 * The key is remembered per browser (`preferences/ai-key-storage.ts`) and its input collapses to a
 * one-line "change key" affordance once saved, keeping the everyday surface to prompt + button.
 */
import { useState } from "react";
import { buttonStyle, disabledButtonStyle, inputStyle, labelStyle } from "./chrome-styles";
import { AiRequestError, generateMermaidFromPrompt } from "../browser/ai-text-to-diagram";
import { readStoredAiKey, writeStoredAiKey } from "../preferences/ai-key-storage";
import { useTranslation } from "../i18n/use-translation";
import type { TranslationKey } from "../i18n/catalog-en";
import { useOfflineHint } from "../hooks/use-online";

function readInitialKey(): string {
  try {
    return typeof window !== "undefined" ? readStoredAiKey(window.localStorage) : "";
  } catch {
    return "";
  }
}

export function MermaidAiSection(props: { onGenerated(source: string): void }) {
  const { onGenerated } = props;
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [apiKey, setApiKey] = useState(readInitialKey);
  const [editingKey, setEditingKey] = useState(() => readInitialKey() === "");
  const [generating, setGenerating] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);

  // Hint-only, never a gate: navigator.onLine can false-negative on WKWebView, and a disabled
  // Generate would have no recovery path — an actual offline attempt fails into the existing
  // error branch below. Renders only in hosts that opted in — see `hooks/use-online.ts`.
  const offline = useOfflineHint();
  const canGenerate = !generating && prompt.trim() !== "" && apiKey.trim() !== "";

  const generate = () => {
    if (!canGenerate) return;
    setGenerating(true);
    setErrorKey(null);
    try {
      writeStoredAiKey(window.localStorage, apiKey.trim());
    } catch {
      // Blocked storage only costs the key its cross-reload memory.
    }
    void generateMermaidFromPrompt({ prompt: prompt.trim(), apiKey: apiKey.trim() })
      .then((source) => {
        if (source === "") {
          setErrorKey("mermaid.ai.error.generic");
          return;
        }
        setEditingKey(false);
        onGenerated(source);
      })
      .catch((error: unknown) => {
        setErrorKey(error instanceof AiRequestError && (error.status === 401 || error.status === 403) ? "mermaid.ai.error.unauthorized" : "mermaid.ai.error.generic");
      })
      .finally(() => setGenerating(false));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 10, marginBottom: 10, borderBottom: "1px solid var(--dd-chrome-border)" }}>
      <span style={labelStyle}>{t("mermaid.ai.description")}</span>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          data-testid="mermaid-ai-prompt"
          value={prompt}
          placeholder={t("mermaid.ai.promptPlaceholder")}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") generate();
          }}
          style={{ ...inputStyle, flex: 1, boxSizing: "border-box" }}
        />
        <button
          type="button"
          data-testid="mermaid-ai-generate"
          disabled={!canGenerate}
          style={{ ...buttonStyle(false), ...(canGenerate ? {} : disabledButtonStyle) }}
          onClick={generate}
        >
          {generating ? t("mermaid.ai.generating") : t("mermaid.ai.generate")}
        </button>
      </div>
      {editingKey ? (
        <input
          data-testid="mermaid-ai-key"
          type="password"
          value={apiKey}
          placeholder={t("mermaid.ai.keyPlaceholder")}
          onChange={(event) => setApiKey(event.target.value)}
          autoComplete="off"
          style={{ ...inputStyle, boxSizing: "border-box" }}
        />
      ) : (
        <button
          type="button"
          data-testid="mermaid-ai-change-key"
          onClick={() => setEditingKey(true)}
          style={{ background: "none", border: "none", cursor: "pointer", alignSelf: "flex-start", padding: 0, fontSize: 11, color: "var(--dd-text-secondary)", textDecoration: "underline" }}
        >
          {t("mermaid.ai.changeKey")}
        </button>
      )}
      {offline && (
        <div data-testid="mermaid-ai-offline" role="status" style={{ fontSize: 12, color: "var(--dd-text-secondary)" }}>
          {t("offline.hint")}
        </div>
      )}
      {errorKey && (
        <div data-testid="mermaid-ai-error" role="alert" style={{ fontSize: 12, color: "var(--dd-danger, #c0392b)" }}>
          {t(errorKey)}
        </div>
      )}
    </div>
  );
}
