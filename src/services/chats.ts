import { currentUser } from "../lib/currentUser";
import { supabase } from "../lib/supabase";
import type { ChatSummary, DialogTheme } from "../types";
export async function listMyChats(includeArchived = false) {
  const { data, error } = await supabase.rpc("list_my_direct_chats", {
    include_archived: includeArchived,
  });
  if (error) throw error;
  return (data ?? []) as ChatSummary[];
}
export async function getOrCreateDirectConversation(otherUserId: string) {
  const { data, error } = await supabase.rpc(
    "get_or_create_direct_conversation",
    { other_user_id: otherUserId },
  );
  if (error) throw error;
  return data as string;
}
export async function setChatSetting(
  cid: string,
  setting: "pin" | "archive" | "mute" | "delete" | "theme",
  enabled = true,
  theme: DialogTheme = "system",
) {
  const { error } = await supabase.rpc("set_chat_setting", {
    cid,
    setting,
    enabled,
    theme,
  });
  if (error) throw error;
  window.dispatchEvent(new Event("apchi:chats-updated"));
}
export function setDialogTheme(cid: string, theme: DialogTheme) {
  return setChatSetting(cid, "theme", true, theme);
}
export async function markConversationRead(cid: string, messageId: string) {
  const { error } = await supabase.rpc("mark_chat_read", {
    cid,
    message_id: messageId,
  });
  if (error) throw error;
  window.dispatchEvent(new Event("apchi:chats-updated"));
}
export async function blockUser(target: string, blocked: boolean) {
  const user = await currentUser();
  if (!user) throw new Error("Нет активной сессии");
  const { error } = blocked
    ? await supabase
        .from("blocked_users")
        .upsert({ blocker_id: user.id, blocked_id: target })
    : await supabase
        .from("blocked_users")
        .delete()
        .eq("blocker_id", user.id)
        .eq("blocked_id", target);
  if (error) throw error;
  window.dispatchEvent(new Event("apchi:chats-updated"));
}
export async function listBlocked() {
  const { data, error } = await supabase.rpc("list_blocked_profiles");
  if (error) throw error;
  return (data ?? []) as {
    id: string;
    username: string;
    display_name: string;
  }[];
}
