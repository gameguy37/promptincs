import type { ScriptBlock } from "@/components/Rundown";
import { normalizeBookmarkElementText, normalizeBookmarkHtml } from "@/lib/bookmarks";
import FileSaver from "file-saver";
const { saveAs } = FileSaver;
import JSZip from "jszip";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  AlignmentType,
} from "docx";
import jsPDF from "jspdf";

/** Strip HTML tags to plain text, preserving paragraph breaks. */
function htmlToPlainParagraphs(html: string): string[] {
  if (typeof document === "undefined") {
    return [html.replace(/<[^>]+>/g, "").trim()];
  }
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";
  // Preserve bookmark markers as literal "[]" in the exported text.
  // (Skip the block-level "block-<id>" anchors which are not user marks.)
  normalizeBookmarkElementText(tmp);
  // Convert <br> to newlines and block-level closes to double newlines.
  tmp.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  const blockSel = "p,div,h1,h2,h3,h4,h5,h6,li,blockquote";
  tmp.querySelectorAll(blockSel).forEach((el) => {
    el.appendChild(document.createTextNode("\n\n"));
  });
  const text = tmp.textContent ?? "";
  return text
    .split(/\n{2,}/)
    .map((s) => s.replace(/\s+$/g, "").replace(/^\s+/g, ""))
    .filter((s) => s.length > 0);
}

function safeFilename(name: string): string {
  return (name || "rundown").replace(/[^a-z0-9-_]+/gi, "_").replace(/^_+|_+$/g, "") || "rundown";
}

function ts(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/**
 * Save a Blob to disk. Tries the File System Access API first so the user
 * can pick any folder + filename (Chrome / Edge / Arc). Falls back to a
 * normal anchor download (Safari / Firefox).
 */
async function saveBlob(
  blob: Blob,
  suggestedName: string,
  description: string,
  mime: string,
  ext: string,
) {
  const w = typeof window !== "undefined" ? (window as any) : null;
  if (w && typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({
        suggestedName,
        types: [{ description, accept: { [mime]: [ext.startsWith(".") ? ext : `.${ext}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err: any) {
      // User cancelled — don't fall back, they explicitly aborted.
      if (err && (err.name === "AbortError" || err.code === 20)) return;
      // Anything else (permission denied, no API, etc.): fall through.
      console.warn("[saveBlob] showSaveFilePicker failed, falling back", err);
    }
  }
  saveAs(blob, suggestedName);
}

// ----- TEXT / MARKDOWN -----

export async function exportMarkdown(name: string, blocks: ScriptBlock[]) {
  const lines: string[] = [`# ${name || "Rundown"}`, ""];
  blocks.forEach((b, i) => {
    const heading = `## ${i + 1}. ${b.title || `Block ${i + 1}`}${b.ghosted ? "  _(GHOSTED)_" : ""}`;
    lines.push(heading, "");
    const paras = htmlToPlainParagraphs(b.body || "");
    if (paras.length === 0) {
      lines.push("_(empty)_", "");
    } else {
      paras.forEach((p) => {
        if (b.ghosted) {
          // strikethrough each line for ghosted blocks
          lines.push(p.split("\n").map((l) => `~~${l}~~`).join("\n"));
        } else {
          lines.push(p);
        }
        lines.push("");
      });
    }
  });
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  await saveBlob(blob, `${safeFilename(name)}-${ts()}.md`, "Markdown", "text/markdown", ".md");
}

// ----- JSON -----

export async function exportJson(name: string, blocks: ScriptBlock[]) {
  const payload = {
    format: "promptinc.rundown.v1",
    name,
    exportedAt: new Date().toISOString(),
    blocks: blocks.map((block) => ({ ...block, body: normalizeBookmarkHtml(block.body || "") })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  await saveBlob(blob, `${safeFilename(name)}-${ts()}.json`, "PrompTinc JSON", "application/json", ".json");
}

// ----- PROPRIETARY PROMPTINC SCRIPT FILE (.promptinc) -----

/**
 * Native PrompTinc script file. Same lossless payload as the JSON export
 * (full HTML formatting — colors, font sizes, highlights, bookmarks, ghosting
 * — is preserved) but written with the branded `.promptinc` extension so it
 * reads and saves as a first-class proprietary script document.
 */
export async function exportPromptinc(name: string, blocks: ScriptBlock[]) {
  const normBlocks = blocks.map((block) => ({
    ...block,
    body: normalizeBookmarkHtml(block.body || ""),
  }));
  const state = {
    format: "promptinc.script.v2",
    name,
    exportedAt: new Date().toISOString(),
    blocks: normBlocks,
  };
  // Word-compatible companion: a standalone HTML file Microsoft Word (and
  // any browser) can open directly. Content-Type mso keeps Word's importer
  // happy; the visible markup is just each block's HTML with the title as an
  // <h1>. This file lives INSIDE the .promptinc archive so external tools
  // can crack it open like a .docx.
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const htmlBody = normBlocks
    .map(
      (b) =>
        `<h1>${escape(b.title || "Untitled Block")}${b.ghosted ? " — GHOSTED" : ""}</h1>\n${b.body || "<p></p>"}`,
    )
    .join("\n<hr/>\n");
  const scriptHtml = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<meta name="ProgId" content="Word.Document"/>
<meta name="Generator" content="PrompTinc"/>
<title>${escape(name || "PrompTinc Script")}</title>
<style>body{font-family:Arial,sans-serif;} h1{font-size:18pt;margin-top:24pt;}</style>
</head>
<body>
<h1 style="font-size:22pt;">${escape(name || "PrompTinc Script")}</h1>
${htmlBody}
</body>
</html>`;
  const zip = new JSZip();
  zip.file("state.json", JSON.stringify(state, null, 2));
  zip.file("script.html", scriptHtml);
  zip.file(
    "README.txt",
    "PrompTinc script archive.\n\n- state.json restores the full editor state inside PrompTinc.\n- script.html is a Word-compatible copy of the script; open it directly in Microsoft Word or any browser.\n",
  );
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    mimeType: "application/vnd.promptinc.script+zip",
  });
  await saveBlob(
    blob,
    `${safeFilename(name)}-${ts()}.promptinc`,
    "PrompTinc Script",
    "application/vnd.promptinc.script+zip",
    ".promptinc",
  );
}

// ----- DOCX -----

export async function exportDocx(name: string, blocks: ScriptBlock[]) {
  const children: Paragraph[] = [];
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: name || "Rundown", bold: true })],
    }),
  );

  blocks.forEach((b, i) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 320, after: 160 },
        children: [
          new TextRun({
            text: `${i + 1}. ${b.title || `Block ${i + 1}`}${b.ghosted ? "  — GHOSTED (skipped on prompter)" : ""}`,
            bold: true,
            color: b.ghosted ? "888888" : undefined,
          }),
        ],
      }),
    );
    const paras = htmlToPlainParagraphs(b.body || "");
    if (paras.length === 0) {
      children.push(
        new Paragraph({
          children: [new TextRun({ text: "(empty)", italics: true, color: "888888" })],
        }),
      );
      return;
    }
    paras.forEach((p) => {
      const lines = p.split("\n");
      lines.forEach((line, idx) => {
        children.push(
          new Paragraph({
            spacing: { after: idx === lines.length - 1 ? 160 : 0 },
            children: [
              new TextRun({
                text: line,
                strike: !!b.ghosted,
                color: b.ghosted ? "888888" : undefined,
              }),
            ],
          }),
        );
      });
    });
  });

  const doc = new Document({
    styles: {
      default: { document: { run: { font: "Arial", size: 24 } } },
      paragraphStyles: [
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 44, bold: true, font: "Arial" },
          paragraph: { spacing: { before: 0, after: 320 } },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { size: 32, bold: true, font: "Arial" },
          paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 0 },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  await saveBlob(
    blob,
    `${safeFilename(name)}-${ts()}.docx`,
    "Word Document",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".docx",
  );
}

// ----- PDF -----

export function exportPdf(name: string, blocks: ScriptBlock[]) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 54; // 0.75"
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (h: number) => {
    if (y + h > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(0, 0, 0);
  ensureSpace(28);
  doc.text(name || "Rundown", margin, y);
  y += 30;

  blocks.forEach((b, i) => {
    // Block heading
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    if (b.ghosted) doc.setTextColor(136, 136, 136);
    else doc.setTextColor(0, 0, 0);
    const heading = `${i + 1}. ${b.title || `Block ${i + 1}`}${b.ghosted ? "  — GHOSTED" : ""}`;
    const headingLines = doc.splitTextToSize(heading, maxW);
    ensureSpace(headingLines.length * 18 + 6);
    doc.text(headingLines, margin, y);
    y += headingLines.length * 18 + 4;

    // Body
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    if (b.ghosted) doc.setTextColor(136, 136, 136);
    else doc.setTextColor(20, 20, 20);
    const paras = htmlToPlainParagraphs(b.body || "");
    if (paras.length === 0) {
      ensureSpace(14);
      doc.setTextColor(136, 136, 136);
      doc.text("(empty)", margin, y);
      y += 14;
    } else {
      paras.forEach((p) => {
        const lines = doc.splitTextToSize(p, maxW);
        lines.forEach((line: string) => {
          ensureSpace(14);
          doc.text(line, margin, y);
          if (b.ghosted) {
            const w = doc.getTextWidth(line);
            doc.setDrawColor(136, 136, 136);
            doc.setLineWidth(0.5);
            doc.line(margin, y - 4, margin + w, y - 4);
          }
          y += 14;
        });
        y += 6;
      });
    }
    y += 8;
  });

  const blob = doc.output("blob");
  // PDF path is awaited by the caller via Promise.resolve.
  void saveBlob(blob, `${safeFilename(name)}-${ts()}.pdf`, "PDF", "application/pdf", ".pdf");
}

// ----- PRINT SHOW (one page per block) -----

/**
 * "Print Show" export — like exportPdf but strictly enforces a hard page break
 * at the start of every Rundown block, so each block begins on a fresh page.
 * Long blocks still flow onto continuation pages as needed.
 */
export function exportShowPdf(name: string, blocks: ScriptBlock[]) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 54; // 0.75"
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - margin * 2;
  let y = margin;

  const ensureSpace = (h: number) => {
    if (y + h > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // Cover line with the show name on page 1.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.setTextColor(0, 0, 0);
  doc.text(name || "Rundown", margin, y);
  y += 30;

  blocks.forEach((b, i) => {
    // HARD page break before every block except the first (which shares the
    // cover page). Each block therefore starts at the top of a fresh page.
    if (i > 0) {
      doc.addPage();
      y = margin;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(b.ghosted ? 136 : 0, b.ghosted ? 136 : 0, b.ghosted ? 136 : 0);
    const heading = `${i + 1}. ${b.title || `Block ${i + 1}`}${b.ghosted ? "  — GHOSTED" : ""}`;
    const headingLines = doc.splitTextToSize(heading, maxW);
    doc.text(headingLines, margin, y);
    y += headingLines.length * 18 + 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(13);
    doc.setTextColor(b.ghosted ? 136 : 20, b.ghosted ? 136 : 20, b.ghosted ? 136 : 20);
    const paras = htmlToPlainParagraphs(b.body || "");
    if (paras.length === 0) {
      doc.setTextColor(136, 136, 136);
      doc.text("(empty)", margin, y);
      y += 16;
    } else {
      paras.forEach((p) => {
        const lines = doc.splitTextToSize(p, maxW);
        lines.forEach((line: string) => {
          ensureSpace(16);
          doc.text(line, margin, y);
          y += 16;
        });
        y += 8;
      });
    }
  });

  const blob = doc.output("blob");
  void saveBlob(blob, `${safeFilename(name)}-show-${ts()}.pdf`, "PDF", "application/pdf", ".pdf");
}