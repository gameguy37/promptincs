import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

/** A pending request from a remote user waiting in the Lobby to be admitted. */
export interface JoinRequest {
  clientId: string;
  name: string;
  role: string;
  pin: string;
  ts: number;
}

export type LobbyStatus = "idle" | "waiting" | "admitted" | "denied";

/**
 * The 'Bouncer & Lobby' handshake. A dedicated `lobby-<sessionId>` Realtime
 * channel — kept separate from the prompter-state and Yjs channels — carries
 * the admission negotiation BEFORE a remote user is connected to the shared
 * document. The host is the bouncer: it validates the PIN and explicitly
 * admits or denies each request.
 */
export function useSessionLobby(params: {
  sessionId: string | null;
  isHost: boolean;
  active: boolean;
  selfId?: string | null;
}) {
  const { sessionId, isHost, active, selfId } = params;
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [status, setStatus] = useState<LobbyStatus>("idle");
  const [denyReason, setDenyReason] = useState<string>("");
  const channelRef = useRef<RealtimeChannel | null>(null);
  /** Anonymous joiners have no account id — fall back to a stable per-tab id
   *  so unauthenticated guests can still be seen and admitted by the host. */
  const anonIdRef = useRef<string>(
    `guest-${Math.random().toString(36).slice(2, 10)}`,
  );
  const selfIdRef = useRef<string>(selfId || anonIdRef.current);
  useEffect(() => {
    selfIdRef.current = selfId || anonIdRef.current;
  }, [selfId]);
  /** Last request payload, re-sent until the host answers (covers requests
   *  fired before the channel finished subscribing, or a host that joins
   *  the lobby channel after the guest). */
  const pendingRef = useRef<JoinRequest | null>(null);
  const statusRef = useRef<LobbyStatus>("idle");
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (!sessionId || !active) return;
    // Offline-first: cloud realtime is optional. If the client can't be
    // created (offline / sandboxed desktop build) we stay in Solo Mode.
    let channel: ReturnType<typeof supabase.channel>;
    try {
      channel = supabase.channel(`lobby-${sessionId}`, {
        config: { broadcast: { self: false, ack: false } },
      });
    } catch {
      return;
    }
    channel.on("broadcast", { event: "join_request" }, ({ payload }) => {
      if (!isHost) return;
      const req = payload as JoinRequest;
      setRequests((prev) =>
        prev.some((r) => r.clientId === req.clientId) ? prev : [...prev, req],
      );
    });
    // A host that comes online after a guest is already waiting pings the
    // lobby so pending guests immediately re-announce themselves.
    channel.on("broadcast", { event: "host_here" }, () => {
      if (isHost) return;
      if (statusRef.current === "waiting" && pendingRef.current) {
        channel.send({ type: "broadcast", event: "join_request", payload: pendingRef.current });
      }
    });
    channel.on("broadcast", { event: "admit" }, ({ payload }) => {
      if (isHost) return;
      if ((payload as { clientId: string }).clientId === selfIdRef.current) {
        pendingRef.current = null;
        statusRef.current = "admitted";
        setStatus("admitted");
      }
    });
    channel.on("broadcast", { event: "deny" }, ({ payload }) => {
      if (isHost) return;
      const p = payload as { clientId: string; reason?: string };
      if (p.clientId === selfIdRef.current) {
        pendingRef.current = null;
        statusRef.current = "denied";
        setDenyReason(p.reason ?? "");
        setStatus("denied");
      }
    });
    channel.subscribe((s) => {
      if (s !== "SUBSCRIBED") return;
      if (isHost) {
        channel.send({ type: "broadcast", event: "host_here", payload: { ts: Date.now() } });
      } else if (statusRef.current === "waiting" && pendingRef.current) {
        channel.send({ type: "broadcast", event: "join_request", payload: pendingRef.current });
      }
    });
    channelRef.current = channel;
    // Guests retry every 2.5s while waiting; hosts re-announce presence so a
    // late-arriving guest is never silently dropped.
    const retry = setInterval(() => {
      const ch = channelRef.current;
      if (!ch) return;
      if (isHost) {
        ch.send({ type: "broadcast", event: "host_here", payload: { ts: Date.now() } });
      } else if (statusRef.current === "waiting" && pendingRef.current) {
        ch.send({ type: "broadcast", event: "join_request", payload: pendingRef.current });
      }
    }, 2500);
    return () => {
      clearInterval(retry);
      try {
        supabase.removeChannel(channel);
      } catch {
        /* already gone */
      }
      channelRef.current = null;
    };
  }, [sessionId, active, isHost]);

  const requestJoin = useCallback(
    (info: { name: string; role: string; pin: string }) => {
      const payload: JoinRequest = {
        clientId: selfIdRef.current,
        name: info.name,
        role: info.role,
        pin: info.pin,
        ts: Date.now(),
      };
      pendingRef.current = payload;
      statusRef.current = "waiting";
      setStatus("waiting");
      // Fires now if the channel is up; otherwise the retry loop / subscribe
      // callback delivers it as soon as it is.
      channelRef.current?.send({ type: "broadcast", event: "join_request", payload });
    },
    [],
  );

  const admit = useCallback((clientId: string) => {
    channelRef.current?.send({
      type: "broadcast",
      event: "admit",
      payload: { clientId },
    });
    setRequests((prev) => prev.filter((r) => r.clientId !== clientId));
  }, []);

  const deny = useCallback((clientId: string, reason?: string) => {
    channelRef.current?.send({
      type: "broadcast",
      event: "deny",
      payload: { clientId, reason },
    });
    setRequests((prev) => prev.filter((r) => r.clientId !== clientId));
  }, []);

  return { requests, status, denyReason, requestJoin, admit, deny, setStatus };
}
