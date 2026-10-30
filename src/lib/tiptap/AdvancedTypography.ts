import { Mark, mergeAttributes } from "@tiptap/core";

export type BaselineValue = "raise" | "lower" | null;
export type LigatureValue = "none" | "all" | null;

export interface AdvancedTypographyAttributes {
  letterSpacing: string | null;
  ligatures: LigatureValue;
  baseline: BaselineValue;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    advancedTypography: {
      /** Merge inline typography attributes onto the current selection. */
      setAdvancedTypography: (attrs: Partial<AdvancedTypographyAttributes>) => ReturnType;
      /** Remove every advanced typography attribute from the selection. */
      unsetAdvancedTypography: () => ReturnType;
    };
  }
}

const BASELINE_STYLE: Record<Exclude<BaselineValue, null>, string> = {
  raise: "position:relative;top:-0.2em",
  lower: "position:relative;top:0.2em",
};

/**
 * TipTap has no built-in support for kerning, ligature control, or baseline
 * shifts. This mark stores those as attributes and renders them as inline CSS
 * so the native macOS Format menu can manipulate the document directly.
 */
export const AdvancedTypography = Mark.create({
  name: "advancedTypography",
  // Allow the mark to coexist with color/highlight/fontSize spans.
  inclusive: false,
  keepOnSplit: false,

  addAttributes() {
    return {
      letterSpacing: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).style.letterSpacing || null,
      },
      ligatures: {
        default: null,
        parseHTML: (el) => {
          const v = (el as HTMLElement).style.fontVariantLigatures;
          return v === "none" || v === "common-ligatures discretionary-ligatures historical-ligatures"
            ? v === "none"
              ? "none"
              : "all"
            : null;
        },
      },
      baseline: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).dataset.baseline || null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-advanced-typography]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { letterSpacing, ligatures, baseline } = HTMLAttributes as Record<string, string | null>;
    const style: string[] = [];
    if (letterSpacing) style.push(`letter-spacing:${letterSpacing}`);
    if (ligatures === "none") style.push("font-variant-ligatures:none");
    if (ligatures === "all")
      style.push(
        "font-variant-ligatures:common-ligatures discretionary-ligatures historical-ligatures",
      );
    if (baseline === "raise" || baseline === "lower") style.push(BASELINE_STYLE[baseline]);
    return [
      "span",
      mergeAttributes(
        { "data-advanced-typography": "" },
        baseline ? { "data-baseline": baseline } : {},
        style.length ? { style: style.join(";") } : {},
      ),
      0,
    ];
  },

  addCommands() {
    return {
      setAdvancedTypography:
        (attrs) =>
        ({ chain, editor }) => {
          const current = editor.getAttributes(this.name) as Partial<AdvancedTypographyAttributes>;
          const next = { ...current, ...attrs };
          const empty = !next.letterSpacing && !next.ligatures && !next.baseline;
          if (empty) return chain().unsetMark(this.name).run();
          return chain().setMark(this.name, next).run();
        },
      unsetAdvancedTypography:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name).run(),
    };
  },
});
