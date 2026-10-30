import { Node, mergeAttributes } from "@tiptap/core";
import { BOOKMARK_TEXT } from "@/lib/bookmarks";

/**
 * Inline atom node that represents a manual bookmark marker ("[]").
 *
 * Round-trips the legacy HTML shape used across the app:
 *   <span data-bookmark="<id>" contenteditable="false" aria-label="Bookmark">[]</span>
 *
 * Keeping the exact same DOM shape means the existing bookmark engine
 * (cmd+[ snapping, exportRundown, importRundown, prompt-mode mirror) keeps
 * working unchanged after the editor is migrated to TipTap.
 *
 * Note: block-level anchors (data-bookmark="block-…") are NOT user marks and
 * are intentionally excluded — they are rendered by the canvas, not the editor.
 */
export interface BookmarkOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    bookmark: {
      /** Insert a bookmark marker at the current selection. */
      insertBookmark: (id?: string) => ReturnType;
    };
  }
}

let bookmarkCounter = 0;
function nextBookmarkId(): string {
  bookmarkCounter += 1;
  return `bm-${Date.now().toString(36)}-${bookmarkCounter}`;
}

export const BookmarkNode = Node.create<BookmarkOptions>({
  name: "bookmark",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-bookmark"),
        renderHTML: (attrs) => (attrs.id ? { "data-bookmark": attrs.id } : {}),
      },
    };
  },

  parseHTML() {
    return [
      {
        // Preferred, clipboard-round-trip-safe shape: identified by its own
        // data attribute (survives paste from Google Docs / Word round-trips
        // where inline `contenteditable` / `data-bookmark` attributes are
        // often stripped).
        tag: 'span[data-custom-bookmark="true"]',
        getAttrs: (node) => {
          const id = (node as HTMLElement).getAttribute("data-bookmark") || "";
          return { id: id && !id.startsWith("block-") ? id : null };
        },
      },
      {
        // Manual bookmarks only — skip block-level anchors.
        tag: "span[data-bookmark]",
        getAttrs: (node) => {
          const id = (node as HTMLElement).getAttribute("data-bookmark") || "";
          if (!id || id.startsWith("block-")) return false;
          return { id };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        contenteditable: "false",
        "aria-label": "Bookmark",
        // Stable clipboard marker — a plain data attribute survives external
        // editors (Docs / Word) far more reliably than `contenteditable`,
        // letting Select All → Copy → Paste round-trip bookmarks losslessly.
        "data-custom-bookmark": "true",
      }),
      BOOKMARK_TEXT,
    ];
  },

  addCommands() {
    return {
      insertBookmark:
        (id) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { id: id || nextBookmarkId() },
          }),
    };
  },
});