import { supabase } from "../lib/supabase";

export async function submitReport(
  reportedUser: string,
  reason: string,
  messageId?: string,
) {
  const clean = reason.trim();
  if (clean.length < 10 || clean.length > 500)
    throw new Error("Опишите причину жалобы: от 10 до 500 символов.");
  const { error } = await supabase.rpc("submit_report", {
    reported_user: reportedUser,
    message_id: messageId ?? null,
    reason: clean,
  });
  if (error) throw error;
}
