import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable";
import { Radio } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function LoginScreen() {
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error("Sign-in failed");
        setLoading(false);
      }
      // On redirect, page navigates away. On success, onAuthStateChange triggers.
    } catch {
      toast.error("Sign-in failed");
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#0a0a0a] text-[#e5e5e5]">
      <div className="w-full max-w-sm rounded-md border border-[#2a2a2a] bg-[#141414] p-8 shadow-xl">
        <div className="mb-6 flex items-center gap-2 text-[#e5e5e5]">
          <Radio className="h-5 w-5 text-[#0055ff]" strokeWidth={1.5} />
          <span className="text-sm font-semibold uppercase tracking-widest">
            Live Teleprompter
          </span>
        </div>
        <h1 className="mb-2 text-xl font-semibold">Sign in to continue</h1>
        <p className="mb-6 text-xs text-[#888]">
          Use your Google account. Your name and avatar are shared with other
          users in your room so the host can see who's editing.
        </p>
        <Button
          onClick={signIn}
          disabled={loading}
          className="w-full bg-white text-[#141414] hover:bg-[#f0f0f0]"
        >
          {loading ? "Redirecting…" : "Continue with Google"}
        </Button>
      </div>
    </div>
  );
}