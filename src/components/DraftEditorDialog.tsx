import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Send, XCircle } from "lucide-react";

type Status = "idle" | "sending" | "success" | "failure";

export interface DraftEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockTitle: string;
  initialHtml: string;
  onPush: (html: string, changeId: string) => void;
  /** Caller wires this to the realtime ACK; call with the change_id we issued. */
  registerAckListener: (changeId: string, onAck: () => void) => () => void;
  /** Update presence so peers see this user is editing this block. */
  onEditingChange?: (editing: boolean) => void;
}

export function DraftEditorDialog({
  open,
  onOpenChange,
  blockTitle,
  initialHtml,
  onPush,
  registerAckListener,
  onEditingChange,
}: DraftEditorDialogProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unregisterRef = useRef<(() => void) | null>(null);

  // Reset content and status whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setStatus("idle");
    setErrorMsg("");
    onEditingChange?.(true);
    queueMicrotask(() => {
      if (editorRef.current) {
        editorRef.current.innerHTML = initialHtml || "<p></p>";
        editorRef.current.focus();
      }
    });
    return () => {
      onEditingChange?.(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (unregisterRef.current) unregisterRef.current();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const push = () => {
    if (!editorRef.current) return;
    const html = editorRef.current.innerHTML;
    const changeId = crypto.randomUUID();
    setStatus("sending");
    setErrorMsg("");

    // Listen for ACK first, then send the proposal.
    if (unregisterRef.current) unregisterRef.current();
    unregisterRef.current = registerAckListener(changeId, () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setStatus("success");
      // Brief success flash, then close.
      setTimeout(() => {
        onOpenChange(false);
      }, 900);
    });

    onPush(html, changeId);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (unregisterRef.current) {
        unregisterRef.current();
        unregisterRef.current = null;
      }
      setStatus("failure");
      setErrorMsg("Failure: Host unreachable. Draft not applied.");
    }, 3000);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (status === "sending") return; // lock while awaiting ack
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl border-[#2a2a2a] bg-[#141414] text-[#e5e5e5]">
        <DialogHeader>
          <DialogTitle>Draft Editor — {blockTitle}</DialogTitle>
          <DialogDescription className="text-[#888]">
            You're in Client mode. Changes here are a draft until the Host accepts.
          </DialogDescription>
        </DialogHeader>

        <div
          ref={editorRef}
          contentEditable={status !== "sending" && status !== "success"}
          suppressContentEditableWarning
          spellCheck={false}
          className="min-h-[200px] max-h-[50vh] overflow-y-auto rounded-md border border-[#2a2a2a] bg-[#0a0a0a] p-3 text-sm leading-relaxed focus:outline-none focus:ring-1 focus:ring-[#3b82f6]"
        />

        {status === "sending" && (
          <div className="flex items-center gap-2 rounded-md border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 text-xs text-[#a3a3a3]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Waiting for Host to apply…
          </div>
        )}
        {status === "success" && (
          <div className="flex items-center gap-2 rounded-md border border-emerald-700/50 bg-emerald-900/30 px-3 py-2 text-xs text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Success: Draft Applied by Host
          </div>
        )}
        {status === "failure" && (
          <div className="flex items-center gap-2 rounded-md border border-red-700/50 bg-red-900/30 px-3 py-2 text-xs text-red-300">
            <XCircle className="h-3.5 w-3.5" />
            {errorMsg}
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={status === "sending" || status === "success"}
          >
            Cancel
          </Button>
          <Button
            onClick={push}
            disabled={status === "sending" || status === "success"}
            className="bg-[#c83232] text-white hover:bg-[#a82828]"
          >
            <Send className="mr-1.5 h-3.5 w-3.5" />
            {status === "failure" ? "Retry push" : "Push Changes to Host"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}