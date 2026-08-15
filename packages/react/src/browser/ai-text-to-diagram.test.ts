import { describe, expect, it, vi } from "vitest";
import { AiRequestError, extractMermaidSource, generateMermaidFromPrompt } from "./ai-text-to-diagram";

const MERMAID = "flowchart TD\n  A[Start] --> B[End]";

function okResponse(text: string): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ content: [{ type: "text", text }] }),
  } as unknown as Response;
}

describe("extractMermaidSource", () => {
  it("returns unfenced replies trimmed", () => {
    expect(extractMermaidSource(`\n${MERMAID}\n`)).toBe(MERMAID);
  });

  it("unwraps a ```mermaid fence the model added despite instructions", () => {
    expect(extractMermaidSource("Here you go:\n```mermaid\n" + MERMAID + "\n```")).toBe(MERMAID);
  });

  it("unwraps a plain ``` fence too", () => {
    expect(extractMermaidSource("```\n" + MERMAID + "\n```")).toBe(MERMAID);
  });
});

describe("generateMermaidFromPrompt", () => {
  it("sends the prompt with the direct-browser-access headers and returns the extracted source", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse(MERMAID));
    const result = await generateMermaidFromPrompt({ prompt: "start then end", apiKey: "sk-test", fetchImpl });

    expect(result).toBe(MERMAID);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers["x-api-key"]).toBe("sk-test");
    expect(init.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    const body = JSON.parse(init.body);
    expect(body.messages).toEqual([{ role: "user", content: "start then end" }]);
    expect(body.system).toContain("Mermaid");
  });

  it("throws an AiRequestError carrying the HTTP status on a provider error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401 } as unknown as Response);
    await expect(generateMermaidFromPrompt({ prompt: "x", apiKey: "bad", fetchImpl })).rejects.toMatchObject({
      name: "AiRequestError",
      status: 401,
    });
  });

  it("wraps network-level failures with a null status", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const failure = await generateMermaidFromPrompt({ prompt: "x", apiKey: "k", fetchImpl }).catch((error: AiRequestError) => error);
    expect(failure).toBeInstanceOf(AiRequestError);
    expect((failure as AiRequestError).status).toBeNull();
  });
});
