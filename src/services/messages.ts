import { currentUser } from "../lib/currentUser";
import { supabase } from "../lib/supabase";
import { validateAttachment } from "../lib/logic";
import type { Message } from "../types";

async function dispatchPush(messageId: string) {
  try {
    await supabase.functions.invoke("send-push", {
      body: { message_id: messageId },
    });
  } catch {
    /* Push delivery is best-effort and must never fail message sending. */
  }
}
// Deterministic keyset pagination avoids the default 1,000-row API truncation.
export async function listMessages(cid: string, before?: Message) {
  let q = supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", cid)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (before)
    q = q.or(
      `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
    );
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as Message[]).reverse();
}
export async function listMessageWindow(cid: string, oldest: string) {
  let result: Message[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", cid)
      .gte("created_at", oldest)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    const page = (data ?? []) as Message[];
    result.push(...page);
    if (page.length < 1000) return result;
  }
}
export async function searchMessages(cid: string, query: string, offset = 0) {
  const term = query.replace(/[\\%_]/g, "\\$&");
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", cid)
    .is("deleted_at", null)
    .ilike("body", `%${term}%`)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + 49);
  if (error) throw error;
  return (data ?? []) as Message[];
}
export async function listMedia(cid: string, offset = 0) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", cid)
    .is("deleted_at", null)
    .not("attachment_path", "is", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + 49);
  if (error) throw error;
  return (data ?? []) as Message[];
}
export async function sendMessage(
  cid: string,
  body: string,
  file?: File,
  id: string = crypto.randomUUID(),
) {
  const user = await currentUser();
  if (!user) throw new Error("Нет активной сессии");
  const path = file ? `${user.id}/${cid}/${id}` : null;
  if (file && path) {
    validateAttachment(file);
    const { error } = await supabase.storage
      .from("attachments")
      .upload(path, file, { upsert: false, contentType: file.type });
    if (error && !/already exists|duplicate/i.test(error.message)) throw error;
  }
  const { data, error } = await supabase
    .from("messages")
    .insert({
      id,
      conversation_id: cid,
      sender_id: user.id,
      body,
      attachment_path: path,
      attachment_name: file?.name ?? null,
      attachment_type: file?.type ?? null,
      attachment_size: file?.size ?? null,
    })
    .select("*")
    .single();
  if (error) {
    // Reconcile an interrupted response with a possibly committed insert.
    const existing = await supabase
      .from("messages")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (existing.data) {
      void dispatchPush(existing.data.id);
      return existing.data as Message;
    }
    throw error;
  }
  void dispatchPush(data.id);
  return data as Message;
}
export async function deleteMessage(message: Message) {
  const { error } = await supabase.rpc("delete_my_message", {
    message_id: message.id,
  });
  if (error) throw error;
  if (message.attachment_path) {
    const { error: storageError } = await supabase.storage
      .from("attachments")
      .remove([message.attachment_path]);
    if (storageError)
      throw new Error(
        "Сообщение удалено. Файл пока остался в закрытом хранилище.",
      );
  }
}
export async function attachmentUrl(path: string, download?: string) {
  const { data, error } = await supabase.storage
    .from("attachments")
    .createSignedUrl(path, 60, download ? { download } : undefined);
  if (error) throw error;
  return data.signedUrl;
}
