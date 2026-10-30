## Context

The app's editor is **not** TipTap today — it's built on raw `contentEditable` + `document.execCommand`, with a block-based HTML model broadcast over Supabase Realtime ("wipe and rewrite"). Real Yjs multiplayer (`y-prosemirror`, `@tiptap/extension-collaboration`, `-cursor`) requires a ProseMirror/TipTap editor, so the foundation must be migrated first. This is staged to avoid breaking the published app (promptincs.lovable.app).

Your confirmed decisions:
- Phased rollout, **TipTap first**, Yjs after the base is stable.
- Producer Portal secured by **unguessable UUID link + a "Who are you?" name modal** (reusing the existing PIN as an optional second layer); no Google login required. The entered name + a random hex color feed Yjs awareness so the operator sees "Producer: Sarah".
- PDF export: **one Rundown block per page**.

---

## Phase 1 — TipTap migration (this phase)

Goal: replace the contentEditable editing surface with a TipTap editor instance per the existing block model, preserving every current feature, with **no behavior change visible to users** and Realtime sync still on the current path.

1. Install `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, plus extensions for bold/italic/underline.
2. Build a custom **Bookmark node extension** so the existing `[]` bookmark markers (`data-bookmark`, `contenteditable=false`) round-trip as ProseMirror nodes instead of raw spans (used by `cmd+[` snapping, export, importRundown).
3. Rewrite `BlockEditor` to mount a TipTap editor bound to `block.body` HTML; emit HTML on update through the existing `onInput` path so Realtime sync and rundown stay unchanged.
4. Re-implement the formatting toolbar to call TipTap commands instead of `execCommand`.
5. Re-wire cross-block features that currently use raw DOM ranges: arrow-key navigation between blocks, Home/End edge jumps, caret/scroll measurement for the continuous canvas, and the red caret-color rule.
6. Verify against the current feature set: bookmarks + `cmd+[` snapping, ghosting, prompt-mode 1:1 mirror, import/export (docx/pdf/md/json), rundown reorder, save-to-disk.

Deliverable: identical UX, now powered by TipTap. No multiplayer yet.

## Phase 2 — Yjs multiplayer core

- Install `yjs`, `y-prosemirror`, `@tiptap/extension-collaboration`, `@tiptap/extension-collaboration-cursor`, and a Supabase Yjs provider (`y-supabase`, pending Worker/runtime validation — fallback: a thin custom provider broadcasting Yjs updates over the existing Realtime channel).
- Replace per-block HTML broadcast with a shared Yjs doc keyed by session id; bind TipTap `Collaboration` to it. Retire "wipe and rewrite" saves; persist Yjs state snapshots instead.
- Multiplayer cursors via `CollaborationCursor` with name + color from awareness.
- Block reorder (Phase 3 spec item) expressed as Yjs structural moves so a producer's active typing isn't interrupted.

## Phase 3 — Producer Portal

- New route `src/routes/producer.$sessionId.tsx` → `/producer/$sessionId`.
- "Join Prompter Session" modal: name/initials input (zod-validated), optional PIN gate reusing existing Display PIN logic, Join button → sets Yjs awareness (`{ name, color }`).
- Simplified Edit Mode: continuous canvas + rundown sidebar + formatting toolbar only; no speed/margins/Prompt Mode controls.

## Phase 4 — Finalize & Export PDF

- "Finalize & Export" button in the operator toolbar.
- Generate PDF from final doc state (extend existing `exportPdf` in `src/lib/exportRundown.ts`), **one block per page**, respecting ghosting markers.

---

## Technical notes

- Editor today: `BlockEditor` (Teleprompter.tsx ~3492) and an inline editor in `Rundown.tsx` (~1520) both use `contentEditable`; bookmarks handled in `src/lib/bookmarks.ts` + `importRundown.ts`.
- Sync today: `src/hooks/useTeleprompterSync.ts` broadcasts whole-block HTML; this stays in Phase 1 and is replaced in Phase 2.
- Risk: the continuous-canvas scroll engine measures DOM per block; the TipTap swap must keep those measurement hooks intact (Phase 1 step 5).
- `y-supabase` must be validated against the Cloudflare Worker runtime before commitment; custom provider is the fallback.
</content>
<summary>Phased plan: migrate the contentEditable editor to TipTap first (this phase), then add Yjs multiplayer, the unguessable-link Producer Portal with a name modal, and one-block-per-page PDF export.</summary>
</invoke>
