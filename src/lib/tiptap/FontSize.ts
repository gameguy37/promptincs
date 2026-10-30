import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * Inline mark that stores an arbitrary font-size as `style="font-size:…"`,
 * matching the legacy `wrapSelection({ fontSize })` output exactly so existing
 * scripts (and the prompt-mode 1:1 mirror) render identically after migration.
 *
 * ProseMirror has no built-in per-selection font-size, so this custom mark is
 * the faithful replacement for the old DOM `<span style="font-size:…">` wrap.
 */
declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
  }
}

export const FontSize = Mark.create({
  name: "fontSize",

  addAttributes() {
    return {
      size: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).style.fontSize || null,
        renderHTML: (attrs) =>
          attrs.size ? { style: `font-size:${attrs.size}` } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "span", getAttrs: (el) => ((el as HTMLElement).style.fontSize ? {} : false) }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setFontSize:
        (size) =>
        ({ chain }) =>
          chain().setMark(this.name, { size }).run(),
      unsetFontSize:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name).run(),
    };
  },
});