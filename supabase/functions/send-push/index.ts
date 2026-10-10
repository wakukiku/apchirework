import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function firstNamedKey(jsonName: string, legacyName: string) {
  const raw = Deno.env.get(jsonName);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed.default) return parsed.default;
      const first = Object.values(parsed)[0];
      if (first) return first;
    } catch {
      // Fall through to the legacy variable.
    }
  }
  return Deno.env.get(legacyName) ?? "";
}

function statusCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const publishable = firstNamedKey(
    "SUPABASE_PUBLISHABLE_KEYS",
    "SUPABASE_ANON_KEY",
  );
  const secret = firstNamedKey(
    "SUPABASE_SECRET_KEYS",
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  const authorization = req.headers.get("Authorization") ?? "";
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "https://apchi.fun";

  if (
    !url ||
    !publishable ||
    !secret ||
    !authorization ||
    !vapidPublic ||
    !vapidPrivate
  ) {
    return json({ error: "Push service is not configured" }, 503);
  }

  const caller = createClient(url, publishable, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
    error: authError,
  } = await caller.auth.getUser();
  if (authError || !user) return json({ error: "Unauthorized" }, 401);

  let messageId = "";
  try {
    const body = (await req.json()) as { message_id?: unknown };
    messageId = typeof body.message_id === "string" ? body.message_id : "";
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(messageId))
    return json({ error: "Invalid message id" }, 400);

  const admin = createClient(url, secret, { auth: { persistSession: false } });

  const { data: message, error: messageError } = await admin
    .from("messages")
    .select(
      "id,conversation_id,sender_id,body,attachment_name,created_at,deleted_at",
    )
    .eq("id", messageId)
    .maybeSingle();

  if (messageError || !message) return json({ error: "Message not found" }, 404);
  if (message.sender_id !== user.id) return json({ error: "Forbidden" }, 403);
  if (message.deleted_at) return json({ delivered: 0, skipped: "deleted" });

  const created = Date.parse(message.created_at);
  if (!Number.isFinite(created) || Date.now() - created > 5 * 60 * 1000)
    return json({ delivered: 0, skipped: "stale" });

  const { data: sender } = await admin
    .from("profiles")
    .select("display_name,username")
    .eq("id", user.id)
    .maybeSingle();

  const { data: members, error: membersError } = await admin
    .from("conversation_members")
    .select("user_id,muted")
    .eq("conversation_id", message.conversation_id)
    .neq("user_id", user.id);
  if (membersError) return json({ error: "Recipient lookup failed" }, 500);

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const title = sender?.display_name || sender?.username || "Apchi";
  const trimmed = String(message.body ?? "").trim();
  const preview = (trimmed || message.attachment_name || "Новое сообщение").slice(
    0,
    160,
  );

  let delivered = 0;
  let skipped = 0;
  let removed = 0;

  for (const member of members ?? []) {
    if (member.muted) {
      skipped++;
      continue;
    }

    const recipientId = member.user_id as string;
    const { data: blocks, error: blockError } = await admin
      .from("blocked_users")
      .select("blocker_id")
      .in("blocker_id", [user.id, recipientId])
      .in("blocked_id", [user.id, recipientId])
      .limit(1);
    if (blockError || (blocks?.length ?? 0) > 0) {
      skipped++;
      continue;
    }

    const { error: claimError } = await admin
      .from("push_delivery_claims")
      .insert({ message_id: message.id, recipient_id: recipientId });
    if (claimError) {
      if (claimError.code === "23505") {
        skipped++;
        continue;
      }
      return json({ error: "Push delivery claim failed" }, 500);
    }

    const { data: subscriptions, error: subscriptionError } = await admin
      .from("push_subscriptions")
      .select("endpoint,p256dh,auth_key")
      .eq("user_id", recipientId);
    if (subscriptionError) return json({ error: "Subscription lookup failed" }, 500);

    for (const subscription of subscriptions ?? []) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.p256dh,
              auth: subscription.auth_key,
            },
          },
          JSON.stringify({
            title,
            body: preview,
            conversation_id: message.conversation_id,
            url: `/chats/${message.conversation_id}`,
          }),
          { TTL: 60, urgency: "high" },
        );
        delivered++;
      } catch (error) {
        const code = statusCode(error);
        if (code === 404 || code === 410) {
          await admin
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", subscription.endpoint);
          removed++;
        }
      }
    }
  }

  return json({ delivered, skipped, removed });
});
