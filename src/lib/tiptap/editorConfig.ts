import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { FontFamily } from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { Superscript } from "@tiptap/extension-superscript";
import { Subscript } from "@tiptap/extension-subscript";
import type { Extensions } from "@tiptap/core";
import { BookmarkNode } from "./BookmarkNode";
import { FontSize } from "./FontSize";
import { AdvancedTypography } from "./AdvancedTypography";
import { SearchAndReplace } from "./SearchAndReplace";
import { SlashCommands } from "./SlashCommands";
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import type * as Y from "yjs";
import type { SupabaseYjsProvider } from "@/lib/collab/SupabaseYjsProvider";
import { cleanPastedHtml } from "@/lib/normalizeScript";

/** When present, the editor joins the shared Yjs document instead of using
 *  its own `content` prop, and renders remote cursors via the caret plugin. */
export interface CollabConfig {
  doc: Y.Doc;
  provider: SupabaseYjsProvider;
  field: string;
  user: { name: string; color: string; role?: string };
}

/**
 * Shared TipTap extension set used by every editing surface (continuous
 * canvas block editor, rundown inline editor, producer portal). Centralizing
 * this guarantees identical document schema everywhere — a prerequisite for
 * the Phase 2 Yjs collaborative document, which requires one shared schema.
 */
export function getEditorExtensions(collab?: CollabConfig): Extensions {
  const base: Extensions = [
    StarterKit.configure({
      // StarterKit (v3) already bundles the Underline mark; do NOT add the
      // standalone @tiptap/extension-underline too — a duplicate extension
      // name corrupts the schema and can leave the editor non-interactive.
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      // Yjs ships its own shared-undo manager; the built-in history MUST be
      // disabled in collaborative mode or the two fight over the doc state.
      ...(collab ? { undoRedo: false as const } : {}),
    }),
    // Inline-style marks: faithful replacements for the legacy DOM span-wrap
    // formatting model (per-selection color / font-family / font-size / highlight).
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    // multicolor keeps per-selection hex highlights; the extended parseHTML in
    // the Highlight extension also captures `background-color` spans pasted
    // from Google Docs / Word so highlights survive the paste round-trip.
    Highlight.extend({
      addAttributes() {
        return {
          color: {
            default: null,
            parseHTML: (el) =>
              (el as HTMLElement).getAttribute("data-color") ||
              (el as HTMLElement).style.backgroundColor ||
              null,
            renderHTML: (attrs) =>
              attrs.color
                ? {
                    "data-color": attrs.color,
                    style: `background-color:${attrs.color};color:inherit`,
                  }
                : {},
          },
        };
      },
      parseHTML() {
        return [
          { tag: "mark" },
          {
            tag: "span",
            getAttrs: (el) =>
              (el as HTMLElement).style.backgroundColor ? {} : false,
          },
        ];
      },
    }).configure({ multicolor: true }),
    BookmarkNode,
    SearchAndReplace,
    // "/" command palette — Highlight, colors, headings, lists.
    SlashCommands,
    // Native macOS Format menu targets: alignment, baseline, and the custom
    // kerning / ligature / baseline-shift mark.
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Superscript,
    Subscript,
    AdvancedTypography,
  ];
  if (collab) {
    base.push(
      Collaboration.configure({ document: collab.doc, field: collab.field }),
      CollaborationCaret.configure({ provider: collab.provider, user: collab.user }),
    );
  }
  return base;
}

/** Editor props shared across surfaces (no Tailwind typography reset; the
 *  app's own `.tp-editor` CSS controls typography for 1:1 prompt mirroring). */
export const sharedEditorProps = {
  attributes: {
    class: "trs1-core-text tp-editor whitespace-pre-wrap",
    spellcheck: "false",
  },
  /**
   * Pasted rich text from Word / Docs / the web carries inline margins,
   * indents, widths and text-align that fight the prompter's centered canvas.
   * Strip layout properties on the way in; keep color / highlight / weight.
   *
   * Hardened: a throw in here (Safari/WebKit lacks some regex features and
   * can bail on exotic clipboard HTML) would propagate into ProseMirror's
   * paste pipeline and leave the view in a broken, un-editable state. Any
   * failure falls back to the raw HTML instead of killing the editor.
   */
  transformPastedHTML: (html: string) => {
    try {
      return cleanPastedHtml(html);
    } catch {
      return html;
    }
  },
} as const;