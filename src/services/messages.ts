import { currentUser } from "../lib/currentUser";
import { supabase } from "../lib/supabase";
import { validateAttachment } from "../lib/logic";
import type { Message } from "../types";

const messageSelect = "*";

const replySelect = "id,sender_id,body,attachment_name,deleted_at";

async function hydrateReplies(messages: Message[]): Promise<Message[]> {
  const replyIds = [
    ...new Set(
      messages
        .map((message) => message.reply_to_message_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  if (!replyIds.length) {
    return messages.map((message) => ({
      ...message,
      reply_to: null,
    })) as Message[];
  }

  const replies = new Map<string, unknown>();

  /*
   * Загружаем reply-сообщения отдельными обычными запросами.
   *
   * Это намеренно не использует embedded self-relation
   * messages -> messages, потому что PostgREST может не видеть
   * такую связь в schema cache даже при существующем foreign key.
   *
   * Батчи не дают .in(...) разрастись до слишком большого URL
   * при загрузке большого окна истории.
   */
  for (let offset = 0; offset < replyIds.length; offset += 100) {
    const ids = replyIds.slice(offset, offset + 100);

    const { data, error } = await supabase
      .from("messages")
      .select(replySelect)
      .in("id", ids);

    if (error) throw error;

    for (const reply of data ?? []) {
      replies.set(reply.id, reply);
    }
  }

  return messages.map((message) => ({
    ...message,
    reply_to: message.reply_to_message_id
      ? (replies.get(message.reply_to_message_id) ?? null)
      : null,
  })) as Message[];
}

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
    .select(messageSelect)
    .eq("conversation_id", cid)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);

  if (before) {
    q = q.or(
      `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
    );
  }

  const { data, error } = await q;

  if (error) throw error;

  return hydrateReplies(((data ?? []) as Message[]).reverse());
}

export async function listMessageWindow(cid: string, oldest: string) {
  const result: Message[] = [];

  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("messages")
      .select(messageSelect)
      .eq("conversation_id", cid)
      .gte("created_at", oldest)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + 999);

    if (error) throw error;

    const page = (data ?? []) as Message[];
    result.push(...page);

    if (page.length < 1000) {
      return hydrateReplies(result);
    }
  }
}

export async function searchMessages(cid: string, query: string, offset = 0) {
  const term = query.replace(/[\\%_]/g, "\\$&");

  const { data, error } = await supabase
    .from("messages")
    .select(messageSelect)
    .eq("conversation_id", cid)
    .is("deleted_at", null)
    .ilike("body", `%${term}%`)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + 49);

  if (error) throw error;

  return hydrateReplies((data ?? []) as Message[]);
}

export async function listMedia(cid: string, offset = 0) {
  const { data, error } = await supabase
    .from("messages")
    .select(messageSelect)
    .eq("conversation_id", cid)
    .is("deleted_at", null)
    .not("attachment_path", "is", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + 49);

  if (error) throw error;

  return hydrateReplies((data ?? []) as Message[]);
}

export async function sendMessage(
  cid: string,
  body: string,
  file?: File,
  id: string = crypto.randomUUID(),
  replyToMessageId?: string,
) {
  const user = await currentUser();

  if (!user) {
    throw new Error("Нет активной сессии");
  }

  const path = file ? `${user.id}/${cid}/${id}` : null;

  if (file && path) {
    validateAttachment(file);

    const { error } = await supabase.storage
      .from("attachments")
      .upload(path, file, {
        upsert: false,
        contentType: file.type,
      });

    if (error && !/already exists|duplicate/i.test(error.message)) {
      throw error;
    }
  }

  const { data, error } = await supabase
    .from("messages")
    .insert({
      id,
      conversation_id: cid,
      sender_id: user.id,
      body,
      reply_to_message_id: replyToMessageId ?? null,
      attachment_path: path,
      attachment_name: file?.name ?? null,
      attachment_type: file?.type ?? null,
      attachment_size: file?.size ?? null,
    })
    .select(messageSelect)
    .single();

  if (error) {
    /*
     * Reconcile an interrupted response with a possibly committed insert.
     */
    const existing = await supabase
      .from("messages")
      .select(messageSelect)
      .eq("id", id)
      .maybeSingle();

    if (existing.data) {
      void dispatchPush(existing.data.id);

      return (await hydrateReplies([existing.data as Message]))[0];
    }

    throw error;
  }

  void dispatchPush(data.id);

  return (await hydrateReplies([data as Message]))[0];
}

export async function getMessage(messageId: string) {
  const { data, error } = await supabase
    .from("messages")
    .select(messageSelect)
    .eq("id", messageId)
    .maybeSingle();

  if (error) throw error;

  if (!data) return null;

  return (await hydrateReplies([data as Message]))[0];
}

export async function deleteMessageForMe(message: Message) {
  const { error } = await supabase.rpc("delete_message_for_me", {
    message_id: message.id,
  });

  if (error) throw error;
}

export async function deleteMessageForEveryone(message: Message) {
  const { data: path, error } = await supabase.rpc(
    "delete_message_for_everyone",
    {
      message_id: message.id,
    },
  );

  if (error) throw error;

  if (path) {
    /*
     * The message is already inaccessible;
     * orphan cleanup is best-effort.
     */
    await supabase.storage.from("attachments").remove([path as string]);
  }
}

export async function attachmentUrl(path: string, download?: string) {
  const { data, error } = await supabase.storage
    .from("attachments")
    .createSignedUrl(path, 60, download ? { download } : undefined);

  if (error) throw error;

  return data.signedUrl;
}
