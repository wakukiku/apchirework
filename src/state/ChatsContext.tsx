import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { listMyChats } from "../services/chats";
import { useAuth } from "./AuthContext";
import { errorText, shouldNotify } from "../lib/logic";
import type { ChatSummary, Message } from "../types";
import { notifyMessage, prepareSound } from "../services/notifications";
type Value = {
  chats: ChatSummary[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  connected: boolean;
};
const Context = createContext<Value | null>(null);
export function ChatsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const path = useRef(location.pathname);
  path.current = location.pathname;
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const sequence = useRef(0);
  const itemsRef = useRef<ChatSummary[]>([]);
  const inFlight = useRef<Promise<void>>();
  const dirty = useRef(false);
  const live = useRef(true);
  const refresh = useCallback((): Promise<void> => {
    if (inFlight.current) {
      dirty.current = true;
      return inFlight.current;
    }
    const request = (async () => {
      do {
        dirty.current = false;
        const ticket = ++sequence.current;
        try {
          const items = await listMyChats(true);
          if (live.current && ticket === sequence.current) {
            itemsRef.current = items;
            setChats(items);
            setError("");
          }
        } catch (e) {
          itemsRef.current = [];
          if (live.current && ticket === sequence.current)
            setError(errorText(e));
        } finally {
          if (live.current) setLoading(false);
        }
      } while (dirty.current && live.current);
    })().finally(() => {
      inFlight.current = undefined;
    });
    inFlight.current = request;
    return request;
  }, []);
  useEffect(() => {
    live.current = true;
    void refresh();
    const seen = new Set<string>();
    const channel = supabase
      .channel("inbox:" + user?.id)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const m = payload.new as Message;
          await refresh();
          if (!user || m.sender_id === user.id || seen.has(m.id)) return;
          seen.add(m.id);
          if (seen.size > 500) seen.delete(seen.values().next().value!);
          try {
            const items = itemsRef.current;
            const c = items.find(
              (c) => c.conversation_id === m.conversation_id,
            );
            if (
              live.current &&
              c &&
              shouldNotify({
                own: false,
                active:
                  path.current === "/chats/" + m.conversation_id &&
                  document.visibilityState === "visible",
                muted: c.muted,
                blocked: c.unavailable,
              })
            ) {
              void notifyMessage(user.id, c, () =>
                navigateRef.current("/chats/" + m.conversation_id),
              );
            }
          } catch {
            /* Inbox error is shown by refresh; never notify with unknown permissions. */
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages" },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_members",
          filter: "user_id=eq." + user?.id,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_appearance" },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_read_receipts",
        },
        () => void refresh(),
      )
      .subscribe((status) => {
        if (live.current) {
          setConnected(status === "SUBSCRIBED");
          if (status === "SUBSCRIBED") void refresh();
        }
      });
    const update = () => void refresh();
    const visibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(update, 30000);
    window.addEventListener("apchi:chats-updated", update);
    window.addEventListener("online", update);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pointerdown", prepareSound);
    return () => {
      live.current = false;
      sequence.current++;
      void supabase.removeChannel(channel);
      clearInterval(interval);
      window.removeEventListener("apchi:chats-updated", update);
      window.removeEventListener("online", update);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pointerdown", prepareSound);
    };
  }, [user?.id, refresh]);
  return (
    <Context.Provider value={{ chats, loading, error, refresh, connected }}>
      {children}
    </Context.Provider>
  );
}
export function useChats() {
  const c = useContext(Context);
  if (!c) throw new Error("Missing ChatsProvider");
  return c;
}
