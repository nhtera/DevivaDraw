/**
 * "Text to diagram": turns a plain-language description into Mermaid flowchart source via the
 * user's own Anthropic API key, called directly browser→provider (no proxy server ever sees the
 * key or the prompt). The result feeds the exact same importer the paste-Mermaid path uses
 * (`tryMermaidToElements`), so this module's whole job is one HTTP call plus response cleanup.
 *
 * `fetchImpl` is injected for the same reason as every other browser seam here: the request
 * building and response extraction are the parts worth unit-testing, and they must be testable
 * without the network.
 */

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 2000;

/**
 * The reply must be raw Mermaid (the fence-stripping below still tolerates a fenced reply, since
 * models add them despite instructions often enough that failing on one would be user-hostile).
 */
const SYSTEM_PROMPT =
  "Convert the user's description into a Mermaid flowchart diagram. " +
  "Reply with ONLY the Mermaid source code — no code fences, no commentary, no explanation. " +
  "Use `flowchart TD` unless the description clearly implies another direction. " +
  "Prefer short node labels; use decision diamonds `{}` for branches and `-->|label|` for labelled edges.";

export class AiRequestError extends Error {
  constructor(
    message: string,
    /** HTTP status when the provider answered at all; `null` for network-level failures. */
    readonly status: number | null,
  ) {
    super(message);
    this.name = "AiRequestError";
  }
}

interface AnthropicMessagesResponse {
  content?: Array<{ type: string; text?: string }>;
}

/** Strips a ``` / ```mermaid fence when the model added one anyway, and trims whitespace. */
export function extractMermaidSource(reply: string): string {
  const fenced = reply.match(/```(?:mermaid)?\s*\n([\s\S]*?)```/);
  return (fenced ? fenced[1]! : reply).trim();
}

export async function generateMermaidFromPrompt(options: {
  prompt: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const { prompt, apiKey, fetchImpl = fetch } = options;
  let response: Response;
  try {
    response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        // Opts into Anthropic's CORS support for direct browser calls — the deliberate
        // architecture here (user's own key, no proxy), not an accident to be "fixed".
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (error) {
    throw new AiRequestError(error instanceof Error ? error.message : String(error), null);
  }
  if (!response.ok) {
    throw new AiRequestError(`Anthropic API responded ${response.status}`, response.status);
  }
  const payload = (await response.json()) as AnthropicMessagesResponse;
  const text = payload.content?.find((block) => block.type === "text")?.text ?? "";
  return extractMermaidSource(text);
}
