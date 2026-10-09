import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "../lib/supabase";
import { detachPushSubscription } from "../services/notifications";
type Value = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  signOut: () => Promise<void>;
  error: string;
};
const Context = createContext<Value | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }
    let active = true;
    let changed = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      changed = true;
      if (active) {
        setSession(next);
        setLoading(false);
        setError("");
      }
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active || changed) return;
        if (error)
          setError("Не удалось восстановить сессию. Обновите страницу.");
        setSession(data.session);
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError("Не удалось восстановить сессию. Обновите страницу.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);
  const value = useMemo(
    () => ({
      configured: supabaseConfigured,
      loading,
      session,
      user: session?.user ?? null,
      error,
      signOut: async () => {
        if (session?.user) {
          await detachPushSubscription();
          await supabase
            .from("profiles")
            .update({ last_seen_at: null })
            .eq("id", session.user.id);
        }
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) throw error;
        try {
          Object.keys(sessionStorage)
            .filter((k) =>
              k.startsWith("apchi-scroll:" + session?.user.id + ":"),
            )
            .forEach((k) => sessionStorage.removeItem(k));
        } catch {}
      },
    }),
    [loading, session, error],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing AuthProvider");
  return value;
}
