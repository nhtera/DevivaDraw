/**
 * XML-escaping for hand-assembled SVG markup strings — `export-to-svg.ts` builds its output by string
 * concatenation (no DOM `SVGElement`/`XMLSerializer` — this needs to run in the engine's DOM-free Node
 * test environment too), so anything derived from user-controlled content (text element strings, color
 * values, embedded JSON) must be escaped by hand before landing in that string. An unescaped `<script>`-
 * looking text element would otherwise become live markup if the exported SVG is later opened directly
 * in a browser — this is the one deliberate XSS-adjacent risk this module guards against explicitly.
 */

/** Escapes the 3 characters unsafe inside XML *text* content (between tags): `&`, `<`, `>`. Order matters — `&` must be escaped first, or a later `&lt;`/`&gt;` substitution would itself get re-escaped. */
export function escapeXmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** `escapeXmlText` plus quote characters — required for content placed inside a `"..."` attribute value, where an unescaped quote would let the content break out of the attribute. */
export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
