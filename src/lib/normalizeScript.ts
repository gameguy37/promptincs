/**
 * Smart Auto-Formatter (¶ FMT).
 *
 * Broadcast scripts arrive from Word, PDF and email in a hostile state:
 * straight quotes, double hyphens, stray page numbers, broken bullet glyphs
 * and enormous run-on paragraphs. `normalizeScript` cleans all of that and
 * re-breaks the copy at natural speech rhythms so the talent reads in
 * phrases instead of walls of text.
 */

/** Abbreviations that end in a period but never end a sentence. */
const ABBREVIATIONS = [
  "Mr", "Mrs", "Ms", "Dr", "Prof", "Sr", "Jr", "St", "Mt", "Rev", "Gen", "Sen",
  "Rep", "Gov", "Lt", "Sgt", "Capt", "Col", "Fr", "Hon", "Messrs", "Esq",
  "Inc", "Ltd", "Co", "Corp", "Dept", "Est", "Approx", "vs", "etc", "al",
  "a.m", "p.m", "U.S", "U.K", "e.g", "i.e",
];

const ABBREV_RE = new RegExp(
  `\\b(?:${ABBREVIATIONS.map((a) => a.replace(/\./g, "\\.")).join("|")})\\.$`,
  "i",
);

/** Curly-quote a plain text run. */
function smartQuotes(input: string): string {
  return input
    // Apostrophes inside words: don't -> don’t
    .replace(/(\w)'(\w)/g, "$1\u2019$2")
    // Opening single quote
    .replace(/(^|[\s([{\u2014-])'/g, "$1\u2018")
    // Any remaining single quote closes
    .replace(/'/g, "\u2019")
    // Opening double quote
    .replace(/(^|[\s([{\u2014-])"/g, "$1\u201C")
    // Any remaining double quote closes
    .replace(/"/g, "\u201D");
}

/** Collapse junk that survives PDF / DOCX extraction. */
function stripArtifacts(input: string): string {
  return input
    // Windows / classic Mac newlines
    .replace(/\r\n?/g, "\n")
    // Standalone page numbers ("12", "- 12 -", "Page 12 of 40")
    .replace(/^[ \t]*(?:-{1,2}\s*)?(?:page\s+)?\d{1,4}(?:\s+of\s+\d{1,4})?[ \t]*(?:-{1,2})?[ \t]*$/gim, "")
    // Broken bullet glyphs left behind by PDF extraction
    .replace(/^[ \t]*[\u00B7\u2022\u25AA\u25CF\u2043\uF0B7oO*][ \t]+/gm, "\u2022 ")
    // Soft hyphens and zero-width junk
    .replace(/[\u00AD\u200B\u200C\u200E\u200F\uFEFF]/g, "")
    // Non-breaking spaces
    .replace(/\u00A0/g, " ")
    // Runs of spaces / tabs
    .replace(/[ \t]{2,}/g, " ")
    // Trailing whitespace per line
    .replace(/[ \t]+$/gm, "")
    // Three or more blank lines collapse to one
    .replace(/\n{3,}/g, "\n\n");
}

/** Punctuation-level typographic fixes. */
function typography(input: string): string {
  return input
    // Double hyphen -> em dash (spaced or not)
    .replace(/\s?--\s?/g, "\u2014")
    // Three dots -> ellipsis
    .replace(/\.\.\.+/g, "\u2026")
    .replace(/\s?->\s?/g, " \u2192 ");
}

/**
 * Break a paragraph into speech-rhythm lines: a soft return after every
 * sentence-ending period, question mark, exclamation point or ellipsis —
 * unless the period belongs to an abbreviation or a decimal number.
 */
export function breakAtSpeechRhythm(paragraph: string): string[] {
  const out: string[] = [];
  let buf = "";
  const chars = Array.from(paragraph);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    buf += ch;
    if (ch !== "." && ch !== "?" && ch !== "!" && ch !== "\u2026") continue;

    // Consume any trailing quote / bracket that belongs to this sentence.
    while (i + 1 < chars.length && /["'\u2019\u201D)\]]/.test(chars[i + 1])) {
      buf += chars[++i];
    }
    const next = chars[i + 1];
    if (next && next !== " " && next !== "\n") continue; // e.g. 3.5, U.S.A
    if (ch === "." && ABBREV_RE.test(buf.trimEnd())) continue;

    const line = buf.trim();
    if (line) out.push(line);
    buf = "";
    // Skip the whitespace that separated the sentences.
    while (i + 1 < chars.length && /\s/.test(chars[i + 1])) i++;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out.length ? out : [paragraph.trim()].filter(Boolean);
}

/** Escape a text run for safe HTML injection. */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Full plain-text normalization pass. Returns cleaned text with one
 * spoken phrase per line and blank lines between paragraphs.
 */
export function normalizeScript(text: string): string {
  const cleaned = typography(smartQuotes(stripArtifacts(text || "")));
  const paragraphs = cleaned.split(/\n{2,}/);
  return paragraphs
    .map((p) =>
      p
        .split("\n")
        .flatMap((line) => breakAtSpeechRhythm(line))
        .filter(Boolean)
        .join("\n"),
    )
    .filter((p) => p.trim().length > 0)
    .join("\n\n");
}

/** Convert normalized plain text into prompter-ready HTML. */
export function textToScriptHtml(text: string): string {
  const paragraphs = normalizeScript(text).split(/\n{2,}/);
  return (
    paragraphs
      .map((p) => {
        const lines = p.split("\n").map(escapeHtml);
        return `<p>${lines.join("<br>")}</p>`;
      })
      .join("") || "<p></p>"
  );
}

/**
 * Normalize an existing rich-text block *in place*, preserving every inline
 * element (colors, highlights, bookmarks). Only text nodes are rewritten, so
 * formatting the operator already applied survives the ¶ FMT pass.
 */
export function normalizeScriptHtml(html: string): string {
  if (typeof document === "undefined") return html;
  const host = document.createElement("div");
  host.innerHTML = html || "";
  stripLayoutStyles(host);
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const raw = node.nodeValue ?? "";
    if (!raw.trim()) continue;
    node.nodeValue = typography(smartQuotes(stripArtifacts(raw))).replace(/\n+/g, " ");
  }
  return host.innerHTML;
}

/**
 * Layout-critical inline styles (margins, padding, alignment, widths, floats,
 * indents) imported from Word/Docs/PDF override the prompter's own centered
 * canvas geometry. Strip them everywhere, keeping ONLY the presentational
 * properties we actually want: color, background/highlight, weight, style,
 * decoration and font-family/size.
 */
const KEEP_STYLE_PROPS = new Set([
  "color",
  "background",
  "background-color",
  "font-weight",
  "font-style",
  "text-decoration",
  "text-decoration-line",
]);

export function stripLayoutStyles(root: HTMLElement): void {
  const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  for (const el of all) {
    el.removeAttribute("align");
    el.removeAttribute("width");
    el.removeAttribute("dir");
    const style = el.getAttribute("style");
    if (!style) continue;
    const kept = style
      .split(";")
      .map((decl) => decl.trim())
      .filter(Boolean)
      .filter((decl) => {
        const prop = decl.slice(0, decl.indexOf(":")).trim().toLowerCase();
        if (!KEEP_STYLE_PROPS.has(prop)) return false;
        // Google Docs stamps `font-weight:normal` on its wrapper <b>; keeping
        // it is harmless, but transparent backgrounds are pure noise.
        const value = decl.slice(decl.indexOf(":") + 1).trim().toLowerCase();
        if (prop.startsWith("background") && /transparent|rgba\(0,\s*0,\s*0,\s*0\)/.test(value))
          return false;
        return true;
      });
    if (kept.length) el.setAttribute("style", kept.join("; "));
    else el.removeAttribute("style");
  }
}

/** Strip layout styles out of an HTML string (paste pipeline). */
export function stripLayoutStylesHtml(html: string): string {
  if (typeof document === "undefined") return html;
  const host = document.createElement("div");
  host.innerHTML = html || "";
  stripLayoutStyles(host);
  return host.innerHTML;
}

/**
 * Google Docs (and Word) paste one empty `<p>` between every visible line —
 * the prompter then shows a full blank line of leading between each phrase.
 * Drop blocks that carry no text and no embedded node (bookmark / image).
 */
export function collapseEmptyBlocks(root: HTMLElement): void {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>("p, div, h1, h2, h3, h4, h5, h6"),
  );
  for (const el of blocks) {
    if (el.querySelector("img, [data-bookmark], table, ul, ol, li, p, div")) continue;
    const text = (el.textContent ?? "").replace(/\u00A0/g, " ").trim();
    if (text) continue;
    // A lone <br> inside an otherwise empty block is still an empty line.
    el.remove();
  }
}

/** Full paste pipeline: scrub layout styles, then remove blank filler lines. */
export function cleanPastedHtml(html: string): string {
  if (typeof document === "undefined") return html;
  const host = document.createElement("div");
  host.innerHTML = html || "";
  unwrapGoogleDocsWrapper(host);
  stripLayoutStyles(host);
  collapseEmptyBlocks(host);
  return host.innerHTML;
}

/**
 * Google Docs wraps an entire copied selection in
 * `<b id="docs-internal-guid-…" style="font-weight:normal">`. Left in place it
 * bolds (or un-bolds) the whole paste and confuses mark parsing. Unwrap it.
 */
export function unwrapGoogleDocsWrapper(root: HTMLElement): void {
  const wrappers = Array.from(
    root.querySelectorAll<HTMLElement>('b[id^="docs-internal-guid"]'),
  );
  for (const el of wrappers) {
    const parent = el.parentNode;
    if (!parent) continue;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  }
}
