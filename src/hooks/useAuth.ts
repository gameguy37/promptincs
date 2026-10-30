import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

function toAppUser(u: User | null | undefined): AppUser | null {
  if (!u) return null;
  const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (meta.full_name as string) ||
    (meta.name as string) ||
    (u.email ? u.email.split("@")[0] : "Anonymous");
  const avatar_url =
    (meta.avatar_url as string) || (meta.picture as string) || null;
  return { id: u.id, name, email: u.email ?? "", avatar_url };
}

export function useAuth() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Offline-first: the cloud client may be unavailable (no network, missing
    // env in a sandboxed Electron build). Never let that block boot — we just
    // fall through to Solo Mode with no signed-in user.
    let unsubscribe: (() => void) | undefined;
    try {
      const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
        setUser(toAppUser(session?.user ?? null));
        setLoading(false);
      });
      unsubscribe = () => sub.subscription.unsubscribe();
      supabase.auth
        .getSession()
        .then(({ data }) => {
          setUser(toAppUser(data.session?.user ?? null));
          setLoading(false);
        })
        .catch(() => {
          setUser(null);
          setLoading(false);
        });
    } catch {
      setUser(null);
      setLoading(false);
    }
    return () => {
      try {
        unsubscribe?.();
      } catch {
        /* client never initialized */
      }
    };
  }, []);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      /* offline sign-out: local state is cleared by the listener anyway */
    }
    setUser(null);
  };

  return { user, loading, signOut };
}

export function colorForUserId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 55%)`;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}