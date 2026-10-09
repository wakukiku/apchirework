import { currentUser } from "../lib/currentUser";
import { supabase } from "../lib/supabase";
import type { Draft } from "../types";
export async function listDrafts() {
  const { data, error } = await supabase
    .from("drafts")
    .select("*")
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Draft[];
}
export async function saveDraft(
  draft: Pick<Draft, "kind" | "title" | "body" | "payload">,
  id?: string,
) {
  const user = await currentUser();
  if (!user) throw new Error("Нет активной сессии");
  const result = id
    ? await supabase
        .from("drafts")
        .update(draft)
        .eq("id", id)
        .eq("user_id", user.id)
        .select("*")
        .single()
    : await supabase
        .from("drafts")
        .insert({ ...draft, user_id: user.id })
        .select("*")
        .single();
  if (result.error) throw result.error;
  return result.data as Draft;
}
export async function updateDraft(
  id: string,
  patch: Pick<Partial<Draft>, "pinned" | "payload">,
) {
  const { data, error } = await supabase
    .from("drafts")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Draft;
}
export async function deleteDraft(id: string) {
  const { error } = await supabase.from("drafts").delete().eq("id", id);
  if (error) throw error;
}
