import { normalizeScriptHtml, textToScriptHtml } from "@/lib/normalizeScript";

export interface ImportedScript {
  /** Suggested block title (derived from the filename). */
  title: string;
  /** Prompter-ready HTML, already run through the ¶ FMT normalizer. */
  html: string;
}

const DOCX_RE = /\.docx?$/i;
const PDF_RE = /\.pdf$/i;
const RTF_RE = /\.rtf$/i;
const TXT_RE = /\.(txt|md|markdown|fountain|fdx|text)$/i;

export function isImportableScriptFile(file: File): boolean {
  return (
    DOCX_RE.test(file.name) ||
    PDF_RE.test(file.name) ||
    RTF_RE.test(file.name) ||
    TXT_RE.test(file.name)
  );
}

function titleFromFile(file: File): string {
  return file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported Script";
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

/**
 * Minimal RTF → plain text. RTF is a control-word soup; we drop groups we
 * can't render, translate \par / \line to newlines and decode \'xx escapes.
 */
export function rtfToText(rtf: string): string {
  let out = rtf;
  // Drop font tables, colour tables, stylesheets and other metadata groups.
  out = out.replace(/\{\\\*?\\(?:fonttbl|colortbl|stylesheet|info|pict|themedata|datastore)[\s\S]*?\}/g, "");
  out = out.replace(/\\par[d]?\b/g, "\n");
  out = out.replace(/\\line\b/g, "\n");
  out = out.replace(/\\tab\b/g, "\t");
  out = out.replace(/\\'([0-9a-f]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
  out = out.replace(/\\u(-?\d+)\??/g, (_m, code) => String.fromCharCode(Number(code) & 0xffff));
  out = out.replace(/\\[a-z]+-?\d*\s?/gi, "");
  out = out.replace(/[{}]/g, "");
  return out.trim();
}

/** DOCX via mammoth — Word styles map straight onto TipTap nodes. */
async function parseDocx(file: File): Promise<string> {
  const mod = (await import("mammoth/mammoth.browser.js")) as unknown as {
    default?: { convertToHtml: (i: unknown, o?: unknown) => Promise<{ value: string }> };
    convertToHtml?: (i: unknown, o?: unknown) => Promise<{ value: string }>;
  };
  const mammoth = mod.default ?? mod;
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml!(
    { arrayBuffer },
    {
      // Explicit Word-style → TipTap node mapping.
      styleMap: [
        "p[style-name='Title'] => h1:fresh",
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Subtitle'] => h3:fresh",
        "p[style-name='Quote'] => blockquote:fresh",
        "b => strong",
        "i => em",
        "u => u",
      ],
    },
  );
  return result.value || "";
}

/** PDF via pdfjs-dist — text items are stitched back into lines. */
async function parsePdf(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  (pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    workerUrl;
  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    let lastY: number | null = null;
    for (const item of content.items as Array<{ str?: string; transform?: number[] }>) {
      if (typeof item.str !== "string") continue;
      const y = item.transform?.[5] ?? null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) text += "\n";
      text += item.str;
      lastY = y;
    }
    pages.push(text);
  }
  return pages.join("\n\n");
}

/**
 * Parse any supported script file into normalized prompter HTML.
 * Throws a human-readable error for unsupported types.
 */
export async function parseScriptFile(file: File): Promise<ImportedScript> {
  const title = titleFromFile(file);
  if (DOCX_RE.test(file.name)) {
    const html = await parseDocx(file);
    return { title, html: normalizeScriptHtml(html) || "<p></p>" };
  }
  if (PDF_RE.test(file.name)) {
    return { title, html: textToScriptHtml(await parsePdf(file)) };
  }
  if (RTF_RE.test(file.name)) {
    return { title, html: textToScriptHtml(rtfToText(await readAsText(file))) };
  }
  if (TXT_RE.test(file.name)) {
    return { title, html: textToScriptHtml(await readAsText(file)) };
  }
  throw new Error(`Unsupported file type: ${file.name}. Use .docx, .pdf, .rtf or .txt`);
}