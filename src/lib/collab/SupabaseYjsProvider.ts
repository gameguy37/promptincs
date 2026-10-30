import * as Y from "yjs";
import {
  Awareness,
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { toBase64, fromBase64 } from "lib0/buffer";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export interface CollabUser {
  name: string;
  color: string;
  /** Role label shown alongside the name in the collaboration cursor tooltip. */
  role?: string;
}

/**
 * Minimal Yjs network provider that rides our existing Supabase Realtime
 * infrastructure. It opens a dedicated `yjs-<room>` broadcast channel (kept
 * separate from the legacy prompter-state channel so the two protocols never
 * interfere) and relays:
 *   - document updates  (event "y-update")
 *   - awareness updates (event "y-awareness")  → drives remote cursors
 *   - a full-state handshake on join (event "y-sync-request")
 *
 * All Yjs binary payloads are base64-encoded for transport over the JSON
 * broadcast channel. Echo loops are prevented by tagging locally-applied
 * updates with `this` as the transaction origin.
 */
export class SupabaseYjsProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  channel: RealtimeChannel | null = null;
  private destroyed = false;
  /** Display name of the peer whose update was most recently applied. */
  lastRemoteEditor: string | null = null;
  private onVisibility?: () => void;
  private onOnline?: () => void;
  private onOffline?: () => void;
  private readonly roomId: string;
  /** Local mirror of the last known network state. When false the provider
   *  keeps operating on the local Yjs doc and queues updates for replay. */
  private connected = false;

  constructor(roomId: string, doc: Y.Doc, user?: CollabUser) {
    this.roomId = roomId;
    this.doc = doc;
    this.awareness = new Awareness(doc);
    if (user) this.awareness.setLocalStateField("user", user);

    this.doc.on("update", this.handleDocUpdate);
    this.awareness.on("update", this.handleAwarenessUpdate);

    // Wire the network layer defensively — a Realtime failure must never
    // crash the editor. IndexedDB persistence (attached in Teleprompter)
    // keeps the local doc alive independently.
    try {
      this.openChannel();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[SupabaseYjsProvider] initial connect failed:", err);
    }

    // Background persistence: never tear the doc connection down when the tab
    // is hidden. When it returns to the foreground, re-request a full sync so
    // any updates missed while throttled converge immediately.
    if (typeof document !== "undefined") {
      this.onVisibility = () => {
        if (this.destroyed) return;
        if (document.visibilityState === "visible") this.resync();
      };
      document.addEventListener("visibilitychange", this.onVisibility);
    }

    // Seamless reconnection: when the browser reports network back, rebuild
    // the Supabase channel and let Yjs converge with any peers.
    if (typeof window !== "undefined") {
      this.onOnline = () => {
        if (this.destroyed) return;
        try {
          this.openChannel();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[SupabaseYjsProvider] reconnect failed:", err);
        }
      };
      this.onOffline = () => {
        this.connected = false;
        this.teardownChannel();
      };
      window.addEventListener("online", this.onOnline);
      window.addEventListener("offline", this.onOffline);
    }
  }

  /** Whether the Realtime channel is currently subscribed. Consumers may
   *  read this to gate UI (e.g. "OFFLINE" badges) without duplicating the
   *  `navigator.onLine` bookkeeping. */
  isConnected(): boolean {
    return this.connected;
  }

  private openChannel() {
    if (this.destroyed) return;
    if (this.channel) this.teardownChannel();
    let channel: ReturnType<typeof supabase.channel>;
    try {
      // Offline-first: local Yjs/IndexedDB keeps working without the cloud.
      channel = supabase.channel(`yjs-${this.roomId}`, {
        config: { broadcast: { self: false, ack: false } },
      });
    } catch {
      this.connected = false;
      return;
    }
    this.channel = channel;
    channel
      .on("broadcast", { event: "y-update" }, ({ payload }) => {
        if (this.destroyed || this.channel !== channel) return;
        try {
          // Remember who sent this edit so the Broadcast Tally can name them.
          this.lastRemoteEditor = typeof payload.n === "string" ? payload.n : null;
          Y.applyUpdate(this.doc, fromBase64(payload.u), this);
        } catch {
          /* malformed payload — ignore */
        }
      })
      .on("broadcast", { event: "y-awareness" }, ({ payload }) => {
        if (this.destroyed || this.channel !== channel) return;
        try {
          applyAwarenessUpdate(this.awareness, fromBase64(payload.u), this);
        } catch {
          /* ignore */
        }
      })
      .on("broadcast", { event: "y-sync-request" }, () => {
        if (!this.destroyed && this.channel === channel) this.sendFullState();
      })
      .subscribe((status) => {
        if (this.destroyed || this.channel !== channel) return;
        if (status === "SUBSCRIBED") {
          this.connected = true;
          // On (re)connect: ask peers for their state, push ours, and announce
          // our awareness (cursor) so everyone converges quickly.
          this.resync();
          const ids = Array.from(this.awareness.getStates().keys());
          if (ids.length > 0) this.broadcastAwareness(ids);
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          this.connected = false;
        }
      });
  }

  private teardownChannel() {
    if (!this.channel) return;
    try {
      supabase.removeChannel(this.channel);
    } catch {
      /* channel already torn down */
    }
    this.channel = null;
  }

  private safeSend(event: string, payload: unknown) {
    if (!this.channel || !this.connected) return;
    try {
      this.channel.send({ type: "broadcast", event, payload });
    } catch {
      // Send failure just means peers won't see this update until we
      // resync — the doc itself is unaffected.
      this.connected = false;
    }
  }

  private resync() {
    if (!this.channel || !this.connected) return;
    this.safeSend("y-sync-request", {});
    this.sendFullState();
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    // Updates we applied from the network are tagged with `this`; don't echo.
    if (origin === this || this.destroyed) return;
    this.safeSend("y-update", { u: toBase64(update), n: this.localName() });
  };

  private handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    // Only broadcast LOCAL awareness changes (origin is null for local edits).
    if (origin === this || this.destroyed) return;
    this.broadcastAwareness([...added, ...updated, ...removed]);
  };

  private broadcastAwareness(clients: number[]) {
    if (clients.length === 0) return;
    this.safeSend("y-awareness", {
      u: toBase64(encodeAwarenessUpdate(this.awareness, clients)),
    });
  }

  private sendFullState() {
    this.safeSend("y-update", { u: toBase64(Y.encodeStateAsUpdate(this.doc)) });
  }

  private localName(): string | undefined {
    const u = this.awareness.getLocalState()?.user as CollabUser | undefined;
    return u?.name;
  }

  setUser(user: CollabUser) {
    this.awareness.setLocalStateField("user", user);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.onVisibility && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibility);
    }
    if (typeof window !== "undefined") {
      if (this.onOnline) window.removeEventListener("online", this.onOnline);
      if (this.onOffline) window.removeEventListener("offline", this.onOffline);
    }
    this.doc.off("update", this.handleDocUpdate);
    this.awareness.off("update", this.handleAwarenessUpdate);
    removeAwarenessStates(this.awareness, [this.doc.clientID], "provider destroyed");
    this.awareness.destroy();
    this.teardownChannel();
  }
}
