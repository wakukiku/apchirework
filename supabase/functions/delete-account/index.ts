import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
async function listPaths(
  client: ReturnType<typeof createClient>,
  bucket: string,
  folder: string,
): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(folder, { limit: 100, offset });
    if (error) throw error;
    for (const item of data ?? []) {
      const next = `${folder}/${item.name}`;
      if (item.id) paths.push(next);
      else paths.push(...(await listPaths(client, bucket, next)));
    }
    if ((data?.length ?? 0) < 100) break;
  }
  return paths;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: cors });
  const url = Deno.env.get("SUPABASE_URL"),
    anon = Deno.env.get("SUPABASE_ANON_KEY"),
    service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = req.headers.get("Authorization");
  if (!url || !anon || !service || !authorization)
    return new Response("Unauthorized", { status: 401, headers: cors });
  const caller = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
    error,
  } = await caller.auth.getUser();
  if (error || !user)
    return new Response("Unauthorized", { status: 401, headers: cors });
  const admin = createClient(url, service, { auth: { persistSession: false } });
  try {
    for (const bucket of ["avatars", "attachments", "dialog-backgrounds"]) {
      const paths = await listPaths(admin, bucket, user.id);
      for (let i = 0; i < paths.length; i += 100) {
        const { error: removeError } = await admin.storage
          .from(bucket)
          .remove(paths.slice(i, i + 100));
        if (removeError) throw removeError;
      }
    }
  } catch {
    return new Response("Storage cleanup failed", {
      status: 500,
      headers: cors,
    });
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError)
    return new Response("Account deletion failed", {
      status: 500,
      headers: cors,
    });
  return new Response(JSON.stringify({ deleted: true }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
