import { describe, expect, it } from "vitest";
import { escapeXmlAttribute, escapeXmlText } from "./svg-escape";

describe("escapeXmlText", () => {
  it("escapes &, <, > in that order without double-escaping", () => {
    expect(escapeXmlText("a & b")).toBe("a &amp; b");
    expect(escapeXmlText("<div>")).toBe("&lt;div&gt;");
    expect(escapeXmlText("a<b>&c")).toBe("a&lt;b&gt;&amp;c");
  });

  it("neutralizes an XSS-style payload so it can never become live markup", () => {
    const payload = "<script>alert(document.cookie)</script>";
    const escaped = escapeXmlText(payload);
    expect(escaped).not.toContain("<script>");
    expect(escaped).toBe("&lt;script&gt;alert(document.cookie)&lt;/script&gt;");
  });

  it("leaves plain text untouched", () => {
    expect(escapeXmlText("hello world 123")).toBe("hello world 123");
  });

  it("does not escape quote characters (only the text-content-unsafe trio)", () => {
    expect(escapeXmlText(`it's "quoted"`)).toBe(`it's "quoted"`);
  });
});

describe("escapeXmlAttribute", () => {
  it("additionally escapes double and single quotes, on top of escapeXmlText's rules", () => {
    expect(escapeXmlAttribute(`it's "quoted" <b>`)).toBe("it&apos;s &quot;quoted&quot; &lt;b&gt;");
  });

  it("prevents breaking out of a double-quoted attribute value", () => {
    const payload = `" onload="alert(1)`;
    const escaped = escapeXmlAttribute(payload);
    expect(escaped).not.toContain('"');
  });
});
