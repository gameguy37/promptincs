import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type SyncRole = "host" | "client";

export interface PrompterState {
  playing: boolean;
  speed: number;
  scrollY: number;
  blank: boolean;
  activeBookmark: number | null;
  tieDyeActive?: boolean;
  /** Host's current view state (Edit vs Prompt) — drives the remote-editor
   *  "host is live in prompt mode" danger warning. */
  hostMode?: "edit" | "prompt";
  /** Preferred cursor target: clients find this DOM id locally and align it to the eyeline. */
  snapNodeId?: string | null;
  /** Fallback: clients align this block's heading + offset if the node id is unavailable. */
  snapBlockId?: string | null;
  snapOffset?: number;
  snapEyelineY?: number;
  ts: number;
}

export interface BlocksPayload {
  blocks: Array<{ id: string; title: string; body: string; bookmarks?: number[] }>;
  activeId: string | null;
  ts: number;
}

export interface DisplayPayload {
  mode?: "edit" | "prompt";
  flipH: boolean;
  flipV: boolean;
  marginH: number;
  marginV: number;
  align: "left" | "center" | "right";
  allCaps: boolean;
  fontFamily: string;
  lineHeight: number;
  bgColor: string;
  showArrow: boolean;
  showTimer: boolean;
  triangleColor: string;
  triangleSize: number;
  eyelineY: number;
  /** Host's exact editor container dimensions, used by remote viewers to
   *  letterbox-mirror the host's viewport 1:1 ("screenshare" parity). */
  hostViewportW?: number;
  hostViewportH?: number;
  ts: number;
}

export interface InitialSyncPayload {
  state: PrompterState;
  blocks: BlocksPayload;
  display: DisplayPayload;
  ts: number;
}

/** Granular per-participant permissions for the Play Along Room. */
export interface ParticipantPermissions {
  /** Read-only: prevents edits or scroll control. */
  observeOnly: boolean;
  /** Allow this participant to edit while in Prompt Mode. */
  editWhilePrompting: boolean;
  /** Allow this participant to edit in Edit Mode. */
  editInEditMode: boolean;
  /** Allow this participant to drive prompter scroll / speed. */
  scrollControl: boolean;
}

export type PermissionsMap = Record<string, ParticipantPermissions>;

export const DEFAULT_OBSERVE_PERMISSIONS: ParticipantPermissions = {
  observeOnly: true,
  editWhilePrompting: false,
  editInEditMode: false,
  scrollControl: false,
};

export const HOST_PERMISSIONS: ParticipantPermissions = {
  observeOnly: false,
  editWhilePrompting: true,
  editInEditMode: true,
  scrollControl: true,
};

export interface PermissionsPayload {
  permissions: PermissionsMap;
  ts: number;
}

export interface PresenceMeta {
  user_id: string;
  name: string;
  avatar_url: string | null;
  color: string;
  role: SyncRole;
  editing_block_id: string | null;
}

export interface ProposeChangePayload {
  change_id: string;
  block_id: string;
  html: string;
  from_user: { id: string; name: string };
}

export interface AckPayload {
  change_id: string;
  by: { id: string; name: string };
}

/** Shared annotation layer payload — any participant may publish. */
export interface AnnotationsPayload {
  annotations: unknown[];
  ts: number;
}

export function useTeleprompterSync(
  role: SyncRole,
  getState: () => PrompterState,
  pin: string | null,
  presenceSelf?: Omit<PresenceMeta, "editing_block_id"> | null,
) {
  const [remoteState, setRemoteState] = useState<PrompterState | null>(null);
  const [remoteBlocks, setRemoteBlocks] = useState<BlocksPayload | null>(null);
  const [remoteDisplay, setRemoteDisplay] = useState<DisplayPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const [roomClosed, setRoomClosed] = useState(false);
  const [kicked, setKicked] = useState(false);
  const [lastReceivedAt, setLastReceivedAt] = useState<number>(0);
  const [peers, setPeers] = useState<PresenceMeta[]>([]);
  const [remotePermissions, setRemotePermissions] = useState<PermissionsMap>({});
  const [remoteAnnotations, setRemoteAnnotations] = useState<AnnotationsPayload | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const editingBlockRef = useRef<string | null>(null);
  const presenceSelfRef = useRef(presenceSelf ?? null);
  useEffect(() => { presenceSelfRef.current = presenceSelf ?? null; }, [presenceSelf]);
  const proposeHandlerRef = useRef<((p: ProposeChangePayload) => void) | null>(null);
  const ackHandlerRef = useRef<((p: AckPayload) => void) | null>(null);

  useEffect(() => {
    if (!pin) {
      setConnected(false);
      return;
    }
    const presenceKey = presenceSelfRef.current?.user_id ?? `anon-${Math.random().toString(36).slice(2, 10)}`;
    // Offline-first: never let a failed cloud client abort the render pass.
    let channel: ReturnType<typeof supabase.channel>;
    try {
      channel = supabase.channel(`room-${pin}`, {
        config: {
          broadcast: { self: false, ack: false },
          presence: { key: presenceKey },
        },
      });
    } catch {
      setConnected(false);
      return;
    }

    channel.on("broadcast", { event: "state" }, (payload) => {
      if (role === "client") {
        setRemoteState(payload.payload as PrompterState);
        setLastReceivedAt(Date.now());
      }
    });
    channel.on("broadcast", { event: "blocks" }, (payload) => {
      if (role === "client") {
        setRemoteBlocks(payload.payload as BlocksPayload);
        setLastReceivedAt(Date.now());
      }
    });
    channel.on("broadcast", { event: "display" }, (payload) => {
      if (role === "client") {
        setRemoteDisplay(payload.payload as DisplayPayload);
        setLastReceivedAt(Date.now());
      }
    });
    channel.on("broadcast", { event: "initial_sync" }, (payload) => {
      if (role !== "client") return;
      const data = payload.payload as InitialSyncPayload;
      setRemoteBlocks(data.blocks);
      setRemoteDisplay(data.display);
      setRemoteState(data.state);
      setLastReceivedAt(Date.now());
    });
    // Re-broadcast handshake — when a client joins, host should re-emit the full current state.
    channel.on("broadcast", { event: "hello" }, () => {
      window.dispatchEvent(new CustomEvent("tp:hello"));
    });
    channel.on("broadcast", { event: "REQUEST_SYNC" }, () => {
      window.dispatchEvent(new CustomEvent("tp:request-sync"));
    });
    channel.on("broadcast", { event: "propose_change" }, (payload) => {
      proposeHandlerRef.current?.(payload.payload as ProposeChangePayload);
    });
    channel.on("broadcast", { event: "acknowledge_receipt" }, (payload) => {
      ackHandlerRef.current?.(payload.payload as AckPayload);
    });
    channel.on("broadcast", { event: "annotations" }, (payload) => {
      setRemoteAnnotations(payload.payload as AnnotationsPayload);
    });
    channel.on("broadcast", { event: "permissions" }, (payload) => {
      if (role === "client") {
        setRemotePermissions((payload.payload as PermissionsPayload).permissions ?? {});
      }
    });
    // Host 'Kill Switch' — when the host closes the room, every remote
    // participant is immediately kicked to the terminated fallback screen.
    channel.on("broadcast", { event: "room_closed" }, () => {
      if (role === "client") setRoomClosed(true);
    });
    // Targeted 'Kick' — the host removes a single participant. Each client
    // checks whether the broadcast target matches its own user id.
    channel.on("broadcast", { event: "kick_user" }, (payload) => {
      if (role !== "client") return;
      const targetId = (payload.payload as { userId: string }).userId;
      if (targetId && targetId === presenceSelfRef.current?.user_id) {
        setKicked(true);
      }
    });
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState<PresenceMeta>();
      const flat: PresenceMeta[] = [];
      for (const arr of Object.values(state)) {
        for (const m of arr) flat.push(m as PresenceMeta);
      }
      setPeers(flat);
    });

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const subscribeWithRecovery = () => {
      channel.subscribe((status) => {
        const isUp = status === "SUBSCRIBED";
        setConnected(isUp);
        if (isUp && role === "client") {
          // Fires on initial connect AND every reconnection — always re-pull
          // the host's current state so the client recovers cleanly.
          channel.send({ type: "broadcast", event: "hello", payload: { ts: Date.now() } });
          channel.send({ type: "broadcast", event: "REQUEST_SYNC", payload: { ts: Date.now() } });
        }
        if (isUp && presenceSelfRef.current) {
          channel.track({
            ...presenceSelfRef.current,
            editing_block_id: editingBlockRef.current,
          } satisfies PresenceMeta);
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          // Backoff and retry — supabase-js auto-reconnects the socket, but we
          // also need to re-attempt the channel subscription itself.
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            try { channel.subscribe(); } catch { /* will retry on next status */ }
          }, 2000);
        }
      });
    };
    subscribeWithRecovery();

    channelRef.current = channel;
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        supabase.removeChannel(channel);
      } catch {
        /* already gone */
      }
      channelRef.current = null;
      setConnected(false);
      setPeers([]);
    };
  }, [role, pin, presenceSelf?.user_id]);

  // Update presence track when self meta (name/avatar/role) changes.
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch || !connected || !presenceSelf) return;
    ch.track({
      ...presenceSelf,
      editing_block_id: editingBlockRef.current,
    } satisfies PresenceMeta);
  }, [connected, presenceSelf]);

  useEffect(() => {
    if (role !== "host") return;
    const id = setInterval(() => {
      const ch = channelRef.current;
      if (!ch) return;
      ch.send({ type: "broadcast", event: "state", payload: getState() });
    }, 100);
    return () => clearInterval(id);
  }, [role, getState]);

  // Keep asking for a full sync until we actually have BLOCKS. The host's
  // 100ms state ticks contain only scroll/playing data — without this guard,
  // the first state packet would silence our polling before any script ever
  // arrives, leaving the extended display with the right scroll position but
  // an empty canvas.
  useEffect(() => {
    if (role !== "client" || !connected || remoteBlocks) return;
    // Send one immediately on connect, then every 400ms until blocks land.
    channelRef.current?.send({ type: "broadcast", event: "REQUEST_SYNC", payload: { ts: Date.now() } });
    const id = setInterval(() => {
      channelRef.current?.send({ type: "broadcast", event: "REQUEST_SYNC", payload: { ts: Date.now() } });
    }, 400);
    return () => clearInterval(id);
  }, [role, connected, remoteBlocks]);

  const broadcastNow = useCallback((state: PrompterState) => {
    const ch = channelRef.current;
    if (!ch || role !== "host") return;
    ch.send({ type: "broadcast", event: "state", payload: state });
  }, [role]);

  const broadcastBlocks = useCallback((payload: BlocksPayload) => {
    const ch = channelRef.current;
    if (!ch || role !== "host") return;
    ch.send({ type: "broadcast", event: "blocks", payload });
  }, [role]);

  const broadcastDisplay = useCallback((payload: DisplayPayload) => {
    const ch = channelRef.current;
    if (!ch || role !== "host") return;
    ch.send({ type: "broadcast", event: "display", payload });
  }, [role]);

  const broadcastInitialSync = useCallback((payload: InitialSyncPayload) => {
    const ch = channelRef.current;
    if (!ch || role !== "host") return;
    ch.send({ type: "broadcast", event: "initial_sync", payload });
  }, [role]);

  const broadcastPermissions = useCallback((permissions: PermissionsMap) => {
    const ch = channelRef.current;
    if (!ch || role !== "host") return;
    ch.send({ type: "broadcast", event: "permissions", payload: { permissions, ts: Date.now() } satisfies PermissionsPayload });
  }, [role]);

  const broadcastRoomClosed = useCallback(() => {
    const ch = channelRef.current;
    if (!ch || role !== "host") return;
    ch.send({ type: "broadcast", event: "room_closed", payload: { ts: Date.now() } });
  }, [role]);

  // Host-only targeted disconnect: eject one participant by user id without
  // affecting the rest of the room or the host's own session.
  const broadcastKickUser = useCallback((userId: string) => {
    const ch = channelRef.current;
    if (!ch || role !== "host") return;
    ch.send({ type: "broadcast", event: "kick_user", payload: { userId, ts: Date.now() } });
  }, [role]);

  /** Manual reconnect trigger for the toolbar "Retry" affordance. The hook
   *  already auto-retries via subscribeWithRecovery, but a user-facing button
   *  lets the operator force an immediate reattempt without waiting for the
   *  next backoff tick. */
  const retryConnection = useCallback(() => {
    const ch = channelRef.current;
    if (!ch) return;
    try { ch.subscribe(); } catch { /* next status callback handles it */ }
  }, []);

  // Background connection persistence (Page Visibility API). When the tab is
  // backgrounded the browser throttles timers and may let the socket go idle.
  // We keep a lightweight heartbeat running regardless of visibility so the
  // host can flip to another app / minimize without losing the room. On
  // returning to the foreground we re-pull a fresh sync immediately.
  useEffect(() => {
    if (!pin) return;
    let beat: ReturnType<typeof setInterval> | null = null;
    const ping = () => {
      const ch = channelRef.current;
      if (!ch) return;
      // A no-op presence/broadcast keeps the websocket warm; never tears down.
      try {
        ch.send({ type: "broadcast", event: "heartbeat", payload: { ts: Date.now(), role } });
      } catch {
        /* socket warming up — next beat retries */
      }
    };
    const startBeat = () => {
      if (beat) return;
      beat = setInterval(ping, 20000);
    };
    const onVisibility = () => {
      // Do NOT pause or tear down on hidden — just keep the heartbeat alive.
      if (document.visibilityState === "hidden") {
        ping();
        startBeat();
      } else {
        ping();
        // Foreground again: actively reconcile state for clients.
        if (role === "client") {
          channelRef.current?.send({ type: "broadcast", event: "REQUEST_SYNC", payload: { ts: Date.now() } });
        }
      }
    };
    startBeat();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (beat) clearInterval(beat);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pin, role]);

  const setEditingBlock = useCallback((id: string | null) => {
    editingBlockRef.current = id;
    const ch = channelRef.current;
    if (!ch || !presenceSelfRef.current) return;
    ch.track({
      ...presenceSelfRef.current,
      editing_block_id: id,
    } satisfies PresenceMeta);
  }, []);

  const sendProposeChange = useCallback((payload: ProposeChangePayload) => {
    const ch = channelRef.current;
    if (!ch) return;
    ch.send({ type: "broadcast", event: "propose_change", payload });
  }, []);

  const sendAck = useCallback((payload: AckPayload) => {
    const ch = channelRef.current;
    if (!ch) return;
    ch.send({ type: "broadcast", event: "acknowledge_receipt", payload });
  }, []);

  /** Publish the full annotation set to the room (any role). */
  const broadcastAnnotations = useCallback((annotations: unknown[]) => {
    const ch = channelRef.current;
    if (!ch) return;
    ch.send({
      type: "broadcast",
      event: "annotations",
      payload: { annotations, ts: Date.now() } satisfies AnnotationsPayload,
    });
  }, []);

  const onProposeChange = useCallback((handler: ((p: ProposeChangePayload) => void) | null) => {
    proposeHandlerRef.current = handler;
  }, []);

  const onAck = useCallback((handler: ((p: AckPayload) => void) | null) => {
    ackHandlerRef.current = handler;
  }, []);

  return {
    remoteState,
    remoteBlocks,
    remoteDisplay,
    connected,
    lastReceivedAt,
    broadcastNow,
    broadcastBlocks,
    broadcastDisplay,
    broadcastInitialSync,
    broadcastPermissions,
    remotePermissions,
    broadcastRoomClosed,
    roomClosed,
    broadcastKickUser,
    kicked,
    peers,
    retryConnection,
    setEditingBlock,
    sendProposeChange,
    sendAck,
    onProposeChange,
    onAck,
    broadcastAnnotations,
    remoteAnnotations,
  };
}
