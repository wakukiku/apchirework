import { supabase } from "../lib/supabase";
export async function deleteAccount() {
  const { error } = await supabase.functions.invoke("delete-account", {
    method: "POST",
  });
  if (error) throw error;
  await supabase.auth.signOut({ scope: "local" });
}
