import type { ScriptBlock } from "@/components/Rundown";

/** Convert a flat string with double-newline paragraph breaks into safe HTML. */
function textToHtml(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length === 0) return "<p></p>";
  return paras.map((p) => `<p>${esc(p).replace(/\n/g, "<br/>")}</p>`).join("");
}

function makeBlock(title: string, body: string): ScriptBlock {
  return {
    id: crypto.randomUUID(),
    title: (title || "Imported").trim().slice(0, 80) || "Imported",
    body: body || "<p></p>",
  };
}

/**
 * Heuristic: split a long plain-text document into multiple blocks at obvious
 * heading boundaries (ALL CAPS lines, "BLOCK 1", "Scene 1", numbered sections).
 * Falls back to a single block if no headings are detected.
 */
function splitIntoBlocks(text: string, fallbackTitle: string): ScriptBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const headingRe =
    /^\s*(?:(?:BLOCK|SCENE|SECTION|PART|CHAPTER|ACT)\s+[\dIVXLC]+|[\dIVXLC]+[.)]\s+\S|[A-Z0-9][A-Z0-9 \-_/&,'"]{3,})\s*:?\s*$/;

  const sections: { title: string; body: string[] }[] = [];
  let current: { title: string; body: string[] } | null = null;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const isHeading =
      line.length > 0 &&
      line.length <= 80 &&
      headingRe.test(line) &&
      // avoid matching ordinary sentences
      !/[.!?]\s/.test(line);
    if (isHeading) {
      if (current) sections.push(current);
      current = { title: line.replace(/[:]+$/, "").trim(), body: [] };
    } else {
      if (!current) current = { title: fallbackTitle, body: [] };
      current.body.push(raw);
    }
  }
  if (current) sections.push(current);

  const cleaned = sections
    .map((s) => ({ title: s.title, text: s.body.join("\n").trim() }))
    .filter((s) => s.text.length > 0 || s.title);

  if (cleaned.length <= 1) {
    return [makeBlock(fallbackTitle, textToHtml(text))];
  }
  return cleaned.map((s) => makeBlock(s.title, textToHtml(s.text)));
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").trim() || "Imported";
}

async function importTxt(file: File): Promise<ScriptBlock[]> {
  const text = await file.text();
  return splitIntoBlocks(text, baseName(file.name));
}

/* ------------------------------------------------------------------ */
/* Custom .docx parser that preserves what mammoth strips:            */
/*   - run colors (w:color, w:highlight, w:shd)                       */
/*   - line spacing (w:spacing/@line)                                 */
/*   - paragraph alignment + indentation                              */
/*   - bold / italic / underline / strike / sub / sup                 */
/*   - real page breaks (<w:br w:type="page"/>) → split into blocks   */
/*     with a bookmark anchor at the top of each new block            */
/* ------------------------------------------------------------------ */

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function attr(el: Element, name: string): string | null {
  // w:* attributes — DOMParser keeps the prefixed name as-is.
  return el.getAttribute(name) ?? el.getAttributeNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", name.replace(/^w:/, ""));
}

function styleString(parts: Record<string, string | null | undefined>): string {
  const out: string[] = [];
  for (const k of Object.keys(parts)) {
    const v = parts[k];
    if (v) out.push(`${k}:${v}`);
  }
  return out.length ? ` style="${out.join(";")}"` : "";
}

function sanitizeImportedHtml(html: string): string {
  if (typeof document === "undefined") return html;
  const template = document.createElement("template");
  template.innerHTML = html || "<p></p>";
  const strip = [
    "line-height",
    "margin-top",
    "margin-bottom",
    "padding-top",
    "padding-bottom",
    "mso-line-height-rule",
  ];
  template.content.querySelectorAll<HTMLElement>("*").forEach((el) => {
    strip.forEach((prop) => el.style.removeProperty(prop));
    const style = el.getAttribute("style");
    if (style !== null && style.trim() === "") el.removeAttribute("style");
  });
  return template.innerHTML;
}

function colorVal(v: string | null): string | null {
  if (!v || v === "auto") return null;
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v}` : v;
}

/** Treat near-black foreground colors as "default" so they inherit the
 *  prompter's white text instead of importing as invisible black-on-black.
 *  Other colors (blue, red, green, etc.) pass through untouched. */
function normalizeFgColor(v: string | null): string | null {
  const c = colorVal(v);
  if (!c) return null;
  if (!/^#[0-9a-f]{6}$/i.test(c)) return c;
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  // Anything within ~10% of pure black counts as "black" → drop.
  if (r < 26 && g < 26 && b < 26) return null;
  return c;
}

/** Treat near-white backgrounds (the default Word page) as "no background"
 *  so the prompter's dark canvas shows through. Colored highlights stay. */
function normalizeBgColor(v: string | null): string | null {
  const c = colorVal(v);
  if (!c) return null;
  if (!/^#[0-9a-f]{6}$/i.test(c)) return c;
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  if (r > 240 && g > 240 && b > 240) return null;
  return c;
}

function renderRun(r: Element): string {
  const rPr = r.getElementsByTagName("w:rPr")[0] as Element | undefined;
  const tags: string[] = [];
  const style: Record<string, string | null> = {};
  if (rPr) {
    if (rPr.getElementsByTagName("w:b")[0]) tags.push("strong");
    if (rPr.getElementsByTagName("w:i")[0]) tags.push("em");
    if (rPr.getElementsByTagName("w:u")[0]) tags.push("u");
    if (rPr.getElementsByTagName("w:strike")[0] || rPr.getElementsByTagName("w:dstrike")[0]) tags.push("s");
    const va = rPr.getElementsByTagName("w:vertAlign")[0] as Element | undefined;
    if (va) {
      const v = attr(va, "w:val");
      if (v === "superscript") tags.push("sup");
      else if (v === "subscript") tags.push("sub");
    }
    const color = rPr.getElementsByTagName("w:color")[0] as Element | undefined;
    if (color) style["color"] = normalizeFgColor(attr(color, "w:val"));
    const hl = rPr.getElementsByTagName("w:highlight")[0] as Element | undefined;
    if (hl) {
      const v = attr(hl, "w:val");
      if (v && v !== "none" && v !== "white") style["background-color"] = v;
    }
    const shd = rPr.getElementsByTagName("w:shd")[0] as Element | undefined;
    if (shd) {
      const v = normalizeBgColor(attr(shd, "w:fill"));
      if (v) style["background-color"] = v;
    }
    const sz = rPr.getElementsByTagName("w:sz")[0] as Element | undefined;
    if (sz) {
      const v = attr(sz, "w:val");
      if (v) style["font-size"] = `${parseInt(v, 10) / 2}pt`;
    }
    const fonts = rPr.getElementsByTagName("w:rFonts")[0] as Element | undefined;
    if (fonts) {
      const f = attr(fonts, "w:ascii") || attr(fonts, "w:hAnsi") || attr(fonts, "w:cs");
      if (f) style["font-family"] = `'${f.replace(/'/g, "")}'`;
    }
  }

  // Collect text + breaks, in document order.
  let inner = "";
  for (const child of Array.from(r.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    const name = el.tagName;
    if (name === "w:t") {
      inner += esc(el.textContent || "");
    } else if (name === "w:tab") {
      inner += "&nbsp;&nbsp;&nbsp;&nbsp;";
    } else if (name === "w:br") {
      // Page breaks are handled outside; only line breaks render here.
      if (attr(el, "w:type") !== "page") inner += "<br/>";
    } else if (name === "w:sym") {
      const ch = attr(el, "w:char");
      if (ch) inner += `&#x${ch};`;
    }
  }
  if (!inner) return "";

  const styled = Object.values(style).some(Boolean)
    ? `<span${styleString(style)}>${inner}</span>`
    : inner;
  let html = styled;
  for (const t of tags) html = `<${t}>${html}</${t}>`;
  return html;
}

function paragraphHasPageBreak(p: Element): boolean {
  const brs = p.getElementsByTagName("w:br");
  for (let i = 0; i < brs.length; i++) {
    if (attr(brs[i] as Element, "w:type") === "page") return true;
  }
  return false;
}

function renderParagraph(p: Element): string {
  const pPr = p.getElementsByTagName("w:pPr")[0] as Element | undefined;
  const style: Record<string, string | null> = {};
  let tag = "p";
  if (pPr) {
    const styleEl = pPr.getElementsByTagName("w:pStyle")[0] as Element | undefined;
    if (styleEl) {
      const v = (attr(styleEl, "w:val") || "").toLowerCase();
      if (/^heading\s*1$|^heading1$|^title$/.test(v)) tag = "h1";
      else if (/^heading\s*2$|^heading2$|^subtitle$/.test(v)) tag = "h2";
      else if (/^heading\s*3$|^heading3$/.test(v)) tag = "h3";
    }
    const jc = pPr.getElementsByTagName("w:jc")[0] as Element | undefined;
    if (jc) {
      const v = attr(jc, "w:val");
      if (v === "center") style["text-align"] = "center";
      else if (v === "right" || v === "end") style["text-align"] = "right";
      else if (v === "both" || v === "distribute") style["text-align"] = "justify";
    }
    const ind = pPr.getElementsByTagName("w:ind")[0] as Element | undefined;
    if (ind) {
      const left = attr(ind, "w:left") || attr(ind, "w:start");
      const right = attr(ind, "w:right") || attr(ind, "w:end");
      if (left) style["margin-left"] = `${parseInt(left, 10) / 20}pt`;
      if (right) style["margin-right"] = `${parseInt(right, 10) / 20}pt`;
    }
    // Word paragraph spacing is intentionally ignored. Imported scripts should
    // use the teleprompter rhythm, not Word's print-page line/margin model.
    const shd = pPr.getElementsByTagName("w:shd")[0] as Element | undefined;
    if (shd) {
      const v = normalizeBgColor(attr(shd, "w:fill"));
      if (v) style["background-color"] = v;
    }
    // Paragraph-level default run formatting (e.g. font color set on the para).
    const pRpr = pPr.getElementsByTagName("w:rPr")[0] as Element | undefined;
    if (pRpr) {
      const color = pRpr.getElementsByTagName("w:color")[0] as Element | undefined;
      if (color) style["color"] = normalizeFgColor(attr(color, "w:val"));
    }
  }

  let inner = "";
  for (const child of Array.from(p.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.tagName === "w:r") inner += renderRun(el);
    else if (el.tagName === "w:hyperlink") {
      let linkInner = "";
      for (const r of Array.from(el.getElementsByTagName("w:r"))) linkInner += renderRun(r as Element);
      if (linkInner) inner += `<a${styleString({ color: "#3b82f6" })}>${linkInner}</a>`;
    }
  }
  if (!inner) inner = "<br/>";
  return `<${tag}${styleString(style)}>${inner}</${tag}>`;
}

async function importDocxRich(file: File): Promise<ScriptBlock[] | null> {
  try {
    const buf = await file.arrayBuffer();
    const JSZipMod: any = await import("jszip");
    const JSZip = JSZipMod.default ?? JSZipMod;
    const zip = await JSZip.loadAsync(buf);
    const docFile = zip.file("word/document.xml");
    if (!docFile) return null;
    const xml = await docFile.async("string");
    const dom = new DOMParser().parseFromString(xml, "application/xml");
    if (dom.getElementsByTagName("parsererror").length > 0) return null;
    const body = dom.getElementsByTagName("w:body")[0];
    if (!body) return null;

    // Walk top-level paragraphs/tables; split into sections on page breaks.
    const sections: { html: string; firstHeading: string | null }[] = [{ html: "", firstHeading: null }];
    const captureHeading = (frag: string) => {
      const m = frag.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i);
      if (!m) return null;
      return m[1].replace(/<[^>]+>/g, "").trim() || null;
    };

    for (const child of Array.from(body.childNodes)) {
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      if (el.tagName === "w:p") {
        const frag = renderParagraph(el);
        const cur = sections[sections.length - 1];
        cur.html += frag;
        if (!cur.firstHeading) cur.firstHeading = captureHeading(frag);
        if (paragraphHasPageBreak(el)) {
          sections.push({ html: "", firstHeading: null });
        }
      } else if (el.tagName === "w:tbl") {
        // Minimal table support: render as <table> with text-only cells.
        let t = '<table style="border-collapse:collapse"><tbody>';
        for (const tr of Array.from(el.getElementsByTagName("w:tr"))) {
          t += "<tr>";
          for (const tc of Array.from((tr as Element).getElementsByTagName("w:tc"))) {
            let cell = "";
            for (const p of Array.from((tc as Element).getElementsByTagName("w:p"))) {
              cell += renderParagraph(p as Element);
            }
            t += `<td style="border:1px solid #444;padding:4px 8px;vertical-align:top">${cell || "<br/>"}</td>`;
          }
          t += "</tr>";
        }
        t += "</tbody></table>";
        sections[sections.length - 1].html += t;
      }
    }

    const filled = sections.filter((s) => s.html.trim().length > 0);
    if (filled.length === 0) return null;

    const base = baseName(file.name);
    const blocks: ScriptBlock[] = filled.map((sec, i) => {
      const title = sec.firstHeading || (filled.length > 1 ? `${base} — ${i + 1}` : base);
      const bookmark =
        filled.length > 1
          ? `<span data-bookmark="pb-${i + 1}" contenteditable="false" aria-label="Bookmark">[]</span>`
          : "";
      return makeBlock(title, sanitizeImportedHtml(bookmark + sec.html));
    });
    return blocks;
  } catch (err) {
    console.warn("[importDocxRich] failed, falling back to mammoth", err);
    return null;
  }
}

async function importDocx(file: File): Promise<ScriptBlock[]> {
  // Try our rich parser first — preserves colors, line spacing, page breaks.
  const rich = await importDocxRich(file);
  if (rich && rich.length > 0) return rich;

  // Fallback: mammoth raw text + heuristic split.
  const buf = await file.arrayBuffer();
  try {
    const mod: any = await import("mammoth");
    const mammoth = mod.default ?? mod;
    const { value: text } = await mammoth.extractRawText({ arrayBuffer: buf });
    if (text && text.trim().length > 0) {
      return splitIntoBlocks(text, baseName(file.name));
    }
    throw new Error("Empty document");
  } catch (err) {
    // Fallback 2: best-effort plain-text salvage so the user never sees a blank screen.
    console.warn("[importDocx] mammoth failed entirely, salvaging plain text", err);
    const bytes = new Uint8Array(buf);
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    // Strip non-printable characters left over from the docx zip container.
    const cleaned = decoded
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    const fallbackText = cleaned.length > 0
      ? cleaned
      : `Could not parse "${file.name}" — the file may be corrupted or password-protected. Try saving it as .txt or .pdf and importing again.`;
    return [makeBlock(baseName(file.name), textToHtml(fallbackText))];
  }
}

async function importPdf(file: File): Promise<ScriptBlock[]> {
  // Lazy-load to keep initial bundle small.
  const pdfjs = await import("pdfjs-dist");
  // Worker via Vite's ?url import.
  const workerSrc = (
    (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")) as { default: string }
  ).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const allText: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it: any) => ("str" in it ? it.str : ""))
      .join(" ")
      .replace(/\s+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ");
    allText.push(pageText);
  }
  const text = allText.join("\n\n");
  return splitIntoBlocks(text, baseName(file.name));
}

async function importJson(file: File): Promise<ScriptBlock[]> {
  // .promptinc v2 is a ZIP archive containing state.json + script.html.
  // Detect the ZIP local-file magic (PK\x03\x04) and unpack; otherwise fall
  // through to the legacy v1 raw-JSON path so old scripts keep opening.
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 4));
  const isZip =
    head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  let jsonText: string;
  if (isZip) {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(buf);
    const entry = zip.file("state.json");
    if (!entry) throw new Error("PrompTinc archive is missing state.json");
    jsonText = await entry.async("string");
  } else {
    jsonText = new TextDecoder("utf-8").decode(buf);
  }
  const data = JSON.parse(jsonText);
  const arr = Array.isArray(data) ? data : data.blocks;
  if (!Array.isArray(arr)) throw new Error("Not a recognized rundown JSON");
  return arr.map((b: any) =>
    makeBlock(b.title ?? "Imported", typeof b.body === "string" ? b.body : "<p></p>"),
  );
}

/** Import any supported file into one or more ScriptBlocks. */
export async function importFile(file: File): Promise<ScriptBlock[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) return importDocx(file);
  if (name.endsWith(".pdf")) return importPdf(file);
  if (name.endsWith(".promptinc") || name.endsWith(".json")) return importJson(file);
  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown")) {
    return importTxt(file);
  }
  if (name.endsWith(".doc")) {
    throw new Error("Legacy .doc files are not supported — please save as .docx and try again.");
  }
  // Best-effort fallback: read as text.
  return importTxt(file);
}