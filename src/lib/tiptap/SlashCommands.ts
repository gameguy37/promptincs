import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import type { Editor, Range } from "@tiptap/core";

/**
 * Slash command palette ("/" in the editor).
 *
 * Rendered with a plain DOM popup rather than a portal so it works inside
 * every editing surface (continuous canvas, rundown inline editor, producer
 * portal) without each one having to mount its own React menu host.
 */
export interface SlashItem {
  title: string;
  hint?: string;
  command: (props: { editor: Editor; range: Range }) => void;
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    title: "Highlight",
    hint: "Yellow marker",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleHighlight({ color: "#ffff00" }).run();
    },
  },
  {
    title: "Clear Highlight",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).unsetHighlight().run();
    },
  },
  {
    title: "Bold",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBold().run();
    },
  },
  {
    title: "Italic",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleItalic().run();
    },
  },
  {
    title: "Heading 1",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
    },
  },
  {
    title: "Heading 2",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
    },
  },
  {
    title: "Bullet List",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Speaker White",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setColor("#ffffff").run();
    },
  },
  {
    title: "Speaker Yellow",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setColor("#fde047").run();
    },
  },
  {
    title: "Speaker Cyan",
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setColor("#22d3ee").run();
    },
  },
];

function createMenu() {
  let el: HTMLDivElement | null = null;
  let items: SlashItem[] = [];
  let selected = 0;
  let onPick: (item: SlashItem) => void = () => {};

  const paint = () => {
    if (!el) return;
    el.innerHTML = "";
    items.forEach((item, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.textContent = item.hint ? `${item.title} · ${item.hint}` : item.title;
      row.className = "tp-slash-item" + (i === selected ? " tp-slash-item--active" : "");
      row.addEventListener("mousedown", (e) => {
        e.preventDefault();
        onPick(item);
      });
      el!.appendChild(row);
    });
  };

  return {
    show(rect: DOMRect | null, next: SlashItem[], pick: (item: SlashItem) => void) {
      items = next;
      onPick = pick;
      selected = 0;
      if (!items.length) {
        this.hide();
        return;
      }
      if (!el) {
        el = document.createElement("div");
        el.className = "tp-slash-menu";
        document.body.appendChild(el);
      }
      paint();
      if (rect) {
        el.style.left = `${Math.round(rect.left)}px`;
        el.style.top = `${Math.round(rect.bottom + 6)}px`;
      }
    },
    update(rect: DOMRect | null, next: SlashItem[], pick?: (item: SlashItem) => void) {
      items = next;
      if (pick) onPick = pick;
      if (!items.length) {
        this.hide();
        return;
      }
      if (!el) return;
      selected = Math.min(selected, items.length - 1);
      paint();
      if (rect) {
        el.style.left = `${Math.round(rect.left)}px`;
        el.style.top = `${Math.round(rect.bottom + 6)}px`;
      }
    },
    move(delta: number) {
      if (!items.length) return;
      selected = (selected + delta + items.length) % items.length;
      paint();
    },
    current() {
      return items[selected] ?? null;
    },
    select() {
      const item = items[selected];
      if (!item) return false;
      onPick(item);
      return true;
    },
    isOpen() {
      return !!el;
    },
    hide() {
      el?.remove();
      el = null;
    },
  };
}

export const SlashCommands = Extension.create({
  name: "slashCommands",

  addProseMirrorPlugins() {
    const menu = createMenu();
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        items: ({ query }) =>
          SLASH_ITEMS.filter((i) =>
            i.title.toLowerCase().includes(query.toLowerCase()),
          ).slice(0, 10),
        command: ({ editor, range, props }) => props.command({ editor, range }),
        render: () => ({
          onStart: (props) => {
            menu.show(props.clientRect?.() ?? null, props.items, (item) =>
              props.command(item),
            );
          },
          onUpdate: (props) => {
            menu.update(props.clientRect?.() ?? null, props.items, (item) =>
              props.command(item),
            );
          },
          onKeyDown: (props) => {
            if (!menu.isOpen()) return false;
            if (props.event.key === "Escape") {
              menu.hide();
              return true;
            }
            if (props.event.key === "ArrowDown") {
              menu.move(1);
              return true;
            }
            if (props.event.key === "ArrowUp") {
              menu.move(-1);
              return true;
            }
            if (props.event.key === "Enter" || props.event.key === "Tab") {
              if (!menu.select()) return false;
              menu.hide();
              return true;
            }
            return false;
          },
          onExit: () => menu.hide(),
        }),
      }),
    ];
  },
});