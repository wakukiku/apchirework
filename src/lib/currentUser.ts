import { supabase } from "./supabase";
export async function currentUser() {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error) throw error;
  if (!session?.user) throw new Error("Нет активной сессии");
  return session.user;
}
