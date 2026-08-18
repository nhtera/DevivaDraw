/**
 * The fixed OOXML parts of a presentation package — everything in a `.pptx` that does not depend on
 * how many slides there are or what they show. Split from `export-to-pptx.ts` so that file stays about
 * layout math and part wiring rather than being buried in boilerplate markup.
 *
 * The part set is minimal but complete: a consumer will open a deck without `docProps`, but it will
 * refuse one whose slide master has no theme, or whose `[Content_Types].xml` fails to declare a part
 * that exists. Both are the failure mode where a file opens in one application and not another, so
 * every part below is here because something requires it, not for completeness' sake.
 */

import { escapeXmlAttribute } from "./svg-escape";

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const P_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const RELS_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export interface Relationship {
  id: string;
  /** The relationship type's suffix under `.../officeDocument/2006/relationships`. */
  type: string;
  target: string;
}

export function relationshipsPart(relationships: readonly Relationship[]): string {
  const entries = relationships.map((rel) => `<Relationship Id="${rel.id}" Type="${REL_TYPE}/${rel.type}" Target="${rel.target}"/>`).join("");
  return `${XML_DECLARATION}<Relationships ${RELS_NS}>${entries}</Relationships>`;
}

/** The package root relationship: the presentation part is the whole document's entry point. */
export const PACKAGE_RELS = relationshipsPart([{ id: "rId1", type: "officeDocument", target: "ppt/presentation.xml" }]);

/** An empty shape tree — the required scaffolding every `cSld` carries, with no shapes in it. */
const EMPTY_SP_TREE =
  '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
  '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';

export const SLIDE_MASTER =
  `${XML_DECLARATION}<p:sldMaster ${P_NS}><p:cSld>${EMPTY_SP_TREE}</p:cSld>` +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>';

export const SLIDE_MASTER_RELS = relationshipsPart([
  { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
  { id: "rId2", type: "theme", target: "../theme/theme1.xml" },
]);

/** One blank layout. Every slide here is a single full-bleed picture, so no placeholder layout would ever be used. */
export const SLIDE_LAYOUT =
  `${XML_DECLARATION}<p:sldLayout ${P_NS} type="blank" preserve="1"><p:cSld name="Blank">${EMPTY_SP_TREE}</p:cSld>` +
  "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>";

export const SLIDE_LAYOUT_RELS = relationshipsPart([{ id: "rId1", type: "slideMaster", target: "../slideMasters/slideMaster1.xml" }]);

/**
 * A theme with the required schemes filled in. Its colors and fonts are never visible — the slides are
 * pictures — but the schemes cannot be empty: `fmtScheme` in particular must carry three fill styles,
 * three line styles, three effect styles and three background fills, and a consumer validating against
 * the schema rejects the part if any list is short.
 */
export const THEME = (() => {
  const color = (name: string, value: string) => `<a:${name}><a:srgbClr val="${value}"/></a:${name}>`;
  const clrScheme =
    '<a:clrScheme name="Deviva"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    color("dk2", "44546A") + color("lt2", "E7E6E6") +
    color("accent1", "4472C4") + color("accent2", "ED7D31") + color("accent3", "A5A5A5") +
    color("accent4", "FFC000") + color("accent5", "5B9BD5") + color("accent6", "70AD47") +
    color("hlink", "0563C1") + color("folHlink", "954F72") + "</a:clrScheme>";
  const font = (tag: string) => `<a:${tag}><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:${tag}>`;
  const fontScheme = `<a:fontScheme name="Deviva">${font("majorFont")}${font("minorFont")}</a:fontScheme>`;
  const solidFill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = `<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr">${solidFill}<a:prstDash val="solid"/></a:ln>`;
  const fmtScheme =
    '<a:fmtScheme name="Deviva">' +
    `<a:fillStyleLst>${solidFill}${solidFill}${solidFill}</a:fillStyleLst>` +
    `<a:lnStyleLst>${line}${line}${line}</a:lnStyleLst>` +
    "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>" +
    `<a:bgFillStyleLst>${solidFill}${solidFill}${solidFill}</a:bgFillStyleLst>` +
    "</a:fmtScheme>";
  return (
    `${XML_DECLARATION}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Deviva">` +
    `<a:themeElements>${clrScheme}${fontScheme}${fmtScheme}</a:themeElements>` +
    "<a:objectDefaults/><a:extraClrSchemeLst/></a:theme>"
  );
})();

/**
 * `[Content_Types].xml`. `Default` entries cover extensions; every part whose type is not implied by
 * its extension needs an `Override`, which is why the slide list has to be threaded in here — a deck
 * missing one slide's override is exactly the file that opens in one application and not the next.
 */
export function contentTypesPart(slideCount: number): string {
  const officeDoc = "application/vnd.openxmlformats-officedocument";
  const override = (part: string, type: string) => `<Override PartName="${part}" ContentType="${type}"/>`;
  const slides = Array.from({ length: slideCount }, (_, index) => override(`/ppt/slides/slide${index + 1}.xml`, `${officeDoc}.presentationml.slide+xml`)).join("");
  return (
    `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    override("/ppt/presentation.xml", `${officeDoc}.presentationml.presentation.main+xml`) +
    override("/ppt/slideMasters/slideMaster1.xml", `${officeDoc}.presentationml.slideMaster+xml`) +
    override("/ppt/slideLayouts/slideLayout1.xml", `${officeDoc}.presentationml.slideLayout+xml`) +
    override("/ppt/theme/theme1.xml", `${officeDoc}.theme+xml`) +
    slides +
    "</Types>"
  );
}

/** The presentation part: the master, the slide id list in deck order, and the deck-wide slide size. */
export function presentationPart(slideCount: number, slideWidthEmu: number, slideHeightEmu: number): string {
  // Slide ids are arbitrary but must be >= 256 and unique; relationship ids run rId2.. because rId1 is the master.
  const slideIds = Array.from({ length: slideCount }, (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join("");
  return (
    `${XML_DECLARATION}<p:presentation ${P_NS}>` +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>' +
    `<p:sldIdLst>${slideIds}</p:sldIdLst>` +
    `<p:sldSz cx="${slideWidthEmu}" cy="${slideHeightEmu}"/>` +
    // Notes pages are portrait by convention; nothing here writes one, but the element is required.
    '<p:notesSz cx="6858000" cy="9144000"/>' +
    "</p:presentation>"
  );
}

export function presentationRels(slideCount: number): string {
  const slides = Array.from({ length: slideCount }, (_, index) => ({ id: `rId${index + 2}`, type: "slide", target: `slides/slide${index + 1}.xml` }));
  return relationshipsPart([
    { id: "rId1", type: "slideMaster", target: "slideMasters/slideMaster1.xml" },
    ...slides,
    { id: `rId${slideCount + 2}`, type: "theme", target: "theme/theme1.xml" },
  ]);
}

/** One slide: a single picture placed at `offset`/`extent` (EMU), which is how a frame gets letterboxed. */
export function slidePart(name: string, offset: { x: number; y: number }, extent: { cx: number; cy: number }): string {
  const picture =
    "<p:pic>" +
    `<p:nvPicPr><p:cNvPr id="2" name="${escapeXmlAttribute(name)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
    '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    `<p:spPr><a:xfrm><a:off x="${offset.x}" y="${offset.y}"/><a:ext cx="${extent.cx}" cy="${extent.cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
    "</p:pic>";
  const spTree =
    '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    `${picture}</p:spTree>`;
  return `${XML_DECLARATION}<p:sld ${P_NS}><p:cSld>${spTree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

export function slideRels(slideNumber: number): string {
  return relationshipsPart([
    { id: "rId1", type: "slideLayout", target: "../slideLayouts/slideLayout1.xml" },
    { id: "rId2", type: "image", target: `../media/image${slideNumber}.png` },
  ]);
}
