import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { applyLicenseKey, useLicense } from "@/lib/license";
import { toast } from "sonner";

interface LicenseModalProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When rendered as the Trial Expired lock, we hide the "close" affordance. */
  lock?: boolean;
}

export function LicenseModal({ open, onOpenChange, lock = false }: LicenseModalProps) {
  const license = useLicense();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const result = applyLicenseKey(key);
    if (result.ok) {
      toast.success("License activated — thank you.");
      setKey("");
      onOpenChange(false);
    } else {
      setError(result.reason ?? "Invalid key.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // In lock mode the modal cannot be dismissed by clicking away.
        if (lock && !v) return;
        onOpenChange(v);
      }}
    >
      <DialogContent
        className="max-w-sm rounded-sm border-[#2a2a2a] bg-[#0c0c0c] text-[#e5e5e5]"
        onEscapeKeyDown={(e) => {
          if (lock) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (lock) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="font-mono text-xs uppercase tracking-[0.24em] text-[#4d8bff]">
            {license.status === "lifetime_unlocked"
              ? "Lifetime Unlocked"
              : license.status === "expired"
                ? "Trial Expired"
                : "License"}
          </DialogTitle>
          <DialogDescription className="text-xs text-[#888]">
            {license.status === "lifetime_unlocked"
              ? "This copy is unlocked for lifetime use."
              : license.status === "expired"
                ? "Your 14-day free trial has ended. Enter a product key to continue using Edit and Prompt modes."
                : `Trial: ${license.daysLeft} day${license.daysLeft === 1 ? "" : "s"} left. Enter a product key any time to unlock.`}
          </DialogDescription>
        </DialogHeader>
        {license.status !== "lifetime_unlocked" && (
          <div className="space-y-3 pt-1">
            <label className="block text-[10px] font-medium uppercase tracking-wider text-[#888]">
              Product Key
            </label>
            <input
              autoFocus
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="PROMPTIN-XXXX-XXXX"
              className="w-full rounded-sm border border-[#2a2a2a] bg-[#141414] px-3 py-2 font-mono text-sm text-white outline-none placeholder:text-[#555] focus:border-[#0055ff]"
            />
            {error && <p className="text-xs text-[#8ab0ff]">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              {!lock && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs uppercase tracking-wider text-[#888] hover:text-white"
                  onClick={() => onOpenChange(false)}
                >
                  Close
                </Button>
              )}
              <Button
                size="sm"
                onClick={submit}
                className="rounded-sm bg-[#0055ff] text-white hover:bg-[#0055ff]"
              >
                Activate
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function TrialExpiredScreen({ onOpenLicense }: { onOpenLicense: () => void }) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a0a] px-4 text-[#e5e5e5]">
      <div className="w-full max-w-md rounded-sm border border-[#2a2a2a] bg-[#141414] p-8 shadow-xl">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.28em] text-[#4d8bff]">
          Trial Expired
        </div>
        <h1 className="mb-3 text-xl font-semibold">
          Your 14-day free trial has ended.
        </h1>
        <p className="mb-6 text-xs leading-relaxed text-[#888]">
          Edit Mode and Prompt Mode are locked until you enter a product key.
          Your local scripts are safe — they'll be right here waiting once you
          activate.
        </p>
        <Button
          onClick={onOpenLicense}
          className="w-full rounded-sm bg-[#0055ff] text-white hover:bg-[#0055ff]"
        >
          Enter Product Key
        </Button>
      </div>
    </div>
  );
}