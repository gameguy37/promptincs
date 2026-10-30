export const BOOKMARK_TEXT = "[]";

const MANUAL_BOOKMARK_SELECTOR = '[data-bookmark]:not([data-bookmark^="block-"])';

export function normalizeBookmarkElementText(root: ParentNode | null): void {
  if (!root || typeof root.querySelectorAll !== "function") return;

  root.querySelectorAll<HTMLElement>(MANUAL_BOOKMARK_SELECTOR).forEach((bookmark) => {
    if (bookmark.textContent !== BOOKMARK_TEXT) {
      bookmark.textContent = BOOKMARK_TEXT;
    }
    bookmark.setAttribute("contenteditable", "false");
    bookmark.setAttribute("aria-label", "Bookmark");
  });
}

export function normalizeBookmarkHtml(html: string): string {
  if (!html || !html.includes("data-bookmark") || typeof document === "undefined") return html;

  const template = document.createElement("template");
  template.innerHTML = html;
  normalizeBookmarkElementText(template.content);
  return template.innerHTML;
}