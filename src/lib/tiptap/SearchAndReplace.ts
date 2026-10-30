import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * Non-destructive Find & Replace for TipTap / ProseMirror.
 *
 * Matches are surfaced purely as inline *decorations* (a ProseMirror view-layer
 * concern). They are NEVER written into the document, so the saved HTML / DB
 * state is untouched while a search is active — exactly the "highlight without
 * wrapping in HTML tags" requirement. Replace operations DO mutate the doc, but
 * only when the user explicitly triggers them, via proper PM transactions.
 */

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    searchAndReplace: {
      setSearchTerm: (searchTerm: string) => ReturnType;
      setReplaceTerm: (replaceTerm: string) => ReturnType;
      setCaseSensitive: (caseSensitive: boolean) => ReturnType;
      setSearchSelectedIndex: (index: number) => ReturnType;
      clearSearch: () => ReturnType;
      replaceCurrent: () => ReturnType;
      replaceAll: () => ReturnType;
    };
  }
}

interface SearchResult {
  from: number;
  to: number;
}

interface SearchStorage {
  searchTerm: string;
  replaceTerm: string;
  caseSensitive: boolean;
  results: SearchResult[];
  selectedIndex: number;
}

const searchPluginKey = new PluginKey("tpSearchAndReplace");

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function gatherText(doc: PMNode): { text: string; map: { from: number }[] } {
  // Build a flat string of all text plus a position map so regex indices can be
  // translated back into absolute document positions.
  let text = "";
  const map: { from: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        text += node.text[i];
        map.push({ from: pos + i });
      }
    } else if (node.isBlock && text.length > 0 && !text.endsWith("\n")) {
      text += "\n";
      map.push({ from: pos });
    }
  });
  return { text, map };
}

function findMatches(doc: PMNode, searchTerm: string, caseSensitive: boolean): SearchResult[] {
  if (!searchTerm) return [];
  const { text, map } = gatherText(doc);
  const results: SearchResult[] = [];
  const flags = caseSensitive ? "g" : "gi";
  let regex: RegExp;
  try {
    regex = new RegExp(escapeRegExp(searchTerm), flags);
  } catch {
    return [];
  }
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m[0].length === 0) {
      regex.lastIndex++;
      continue;
    }
    const startEntry = map[m.index];
    const endEntry = map[m.index + m[0].length - 1];
    if (startEntry && endEntry) {
      results.push({ from: startEntry.from, to: endEntry.from + 1 });
    }
  }
  return results;
}

export const SearchAndReplace = Extension.create<{ searchResultClass: string }, SearchStorage>({
  name: "searchAndReplace",

  addOptions() {
    return { searchResultClass: "tp-search-result" };
  },

  addStorage() {
    return {
      searchTerm: "",
      replaceTerm: "",
      caseSensitive: false,
      results: [],
      selectedIndex: 0,
    };
  },

  addCommands() {
    const refresh = (editor: import("@tiptap/core").Editor) => {
      const { searchTerm, caseSensitive } = (editor.storage as unknown as Record<string, SearchStorage>).searchAndReplace as SearchStorage;
      const results = findMatches(editor.state.doc, searchTerm, caseSensitive);
      (editor.storage as unknown as Record<string, SearchStorage>).searchAndReplace.results = results;
      if ((editor.storage as unknown as Record<string, SearchStorage>).searchAndReplace.selectedIndex >= results.length) {
        (editor.storage as unknown as Record<string, SearchStorage>).searchAndReplace.selectedIndex = 0;
      }
      // Kick the plugin to recompute decorations.
      editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, true));
    };

    return {
      setSearchTerm:
        (searchTerm) =>
        ({ editor }) => {
          (editor.storage as unknown as Record<string, SearchStorage>).searchAndReplace.searchTerm = searchTerm;
          (editor.storage as unknown as Record<string, SearchStorage>).searchAndReplace.selectedIndex = 0;
          refresh(editor);
          return true;
        },
      setReplaceTerm:
        (replaceTerm) =>
        ({ editor }) => {
          (editor.storage as unknown as Record<string, SearchStorage>).searchAndReplace.replaceTerm = replaceTerm;
          return true;
        },
      setCaseSensitive:
        (caseSensitive) =>
        ({ editor }) => {
          (editor.storage as unknown as Record<string, SearchStorage>).searchAndReplace.caseSensitive = caseSensitive;
          refresh(editor);
          return true;
        },
      setSearchSelectedIndex:
        (index) =>
        ({ editor }) => {
          (editor.storage as unknown as Record<string, SearchStorage>).searchAndReplace.selectedIndex = index;
          editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, true));
          return true;
        },
      clearSearch:
        () =>
        ({ editor }) => {
          (editor.storage as unknown as Record<string, SearchStorage>).searchAndReplace.searchTerm = "";
          (editor.storage as unknown as Record<string, SearchStorage>).searchAndReplace.results = [];
          (editor.storage as unknown as Record<string, SearchStorage>).searchAndReplace.selectedIndex = 0;
          editor.view.dispatch(editor.state.tr.setMeta(searchPluginKey, true));
          return true;
        },
      replaceCurrent:
        () =>
        ({ editor, tr, dispatch }) => {
          const s = (editor.storage as unknown as Record<string, SearchStorage>).searchAndReplace as SearchStorage;
          const result = s.results[s.selectedIndex];
          if (!result) return false;
          if (dispatch) {
            tr.insertText(s.replaceTerm, result.from, result.to);
            dispatch(tr);
          }
          // Recompute after the doc changed.
          setTimeout(() => refresh(editor), 0);
          return true;
        },
      replaceAll:
        () =>
        ({ editor, tr, dispatch }) => {
          const s = (editor.storage as unknown as Record<string, SearchStorage>).searchAndReplace as SearchStorage;
          if (s.results.length === 0) return false;
          if (dispatch) {
            // Replace back-to-front so earlier positions stay valid.
            const sorted = [...s.results].sort((a, b) => b.from - a.from);
            for (const r of sorted) {
              tr.insertText(s.replaceTerm, r.from, r.to);
            }
            dispatch(tr);
          }
          setTimeout(() => refresh(editor), 0);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const extension = this;
    return [
      new Plugin({
        key: searchPluginKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, old) {
            const s = extension.storage as SearchStorage;
            const meta = tr.getMeta(searchPluginKey);
            if (!meta && !tr.docChanged) return old.map(tr.mapping, tr.doc);
            if (s.results.length === 0) return DecorationSet.empty;
            const cls = extension.options.searchResultClass;
            const decos = s.results
              .filter((r) => r.from >= 0 && r.to <= tr.doc.content.size)
              .map((r, i) =>
                Decoration.inline(r.from, r.to, {
                  class: i === s.selectedIndex ? `${cls} ${cls}--active` : cls,
                }),
              );
            return DecorationSet.create(tr.doc, decos);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

export type { SearchResult, SearchStorage };
