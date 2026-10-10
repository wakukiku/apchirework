import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const a = "10000000-0000-4000-8000-000000000001",
  b = "10000000-0000-4000-8000-000000000002",
  c = "10000000-0000-4000-8000-000000000003";
async function sql(text, params = []) {
  return (await db.query(text, params)).rows;
}
async function as(id) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
test("fresh schema + Stage 1.1 + web migration: account isolation and actual RPCs", async () => {
  await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth,public,storage to authenticated,anon;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,created_at timestamptz default now(),unique(bucket_id,name));
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
  grant all on all tables in schema storage to authenticated;
  alter default privileges in schema public grant all on tables to authenticated,anon;
  create publication supabase_realtime;
 `);
  // PGlite supplies gen_random_uuid in core; pgcrypto extension isn't used by these migrations.
  for (const file of [
    "tests/fixtures/schema_stage1.sql",
    "supabase/migrations/002_stage_1_1.sql",
    "supabase/migrations/003_web_complete.sql",
    "supabase/migrations/004_gallery_colors_backgrounds.sql",
    "supabase/migrations/005_public_release.sql",
    "supabase/migrations/006_web_push.sql",
    "supabase/migrations/007_chat_experience.sql",
  ]) {
    let source = await readFile(new URL("../" + file, import.meta.url), "utf8");
    source = source.replace("create extension if not exists pgcrypto;", "");
    await db.exec(source);
    if (file.endsWith("002_stage_1_1.sql")) {
      await db.exec(`
        insert into auth.users(id,email) values('90000000-0000-4000-8000-000000000001','legacy@example.invalid');
        insert into conversations(id) values('90000000-0000-4000-8000-000000000002');
        insert into conversation_members(conversation_id,user_id,dialog_theme) values('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001','sage');
        insert into messages(conversation_id,sender_id,body) values('90000000-0000-4000-8000-000000000002','90000000-0000-4000-8000-000000000001','Existing history');
        insert into drafts(user_id,title) values('90000000-0000-4000-8000-000000000001','Existing note');
      `);
    }
  }
  assert.equal(
    (
      await sql(
        "select body from messages where sender_id='90000000-0000-4000-8000-000000000001'",
      )
    )[0].body,
    "Existing history",
  );
  assert.equal(
    (
      await sql(
        "select dialog_theme from conversation_appearance where conversation_id='90000000-0000-4000-8000-000000000002'",
      )
    )[0].dialog_theme,
    "sage",
  );
  assert.equal(
    (
      await sql(
        "select title from drafts where user_id='90000000-0000-4000-8000-000000000001'",
      )
    )[0].title,
    "Existing note",
  );
  await db.query(
    'insert into auth.users(id,email,raw_user_meta_data) values ($1,\'one@example.invalid\',\'{"username":"one","display_name":"One"}\'),($2,\'two@example.invalid\',\'{"username":"two","display_name":"Two"}\'),($3,\'three@example.invalid\',\'{"username":"three","display_name":"Three"}\')',
    [a, b, c],
  );
  await as(a);
  const cid = (
    await sql("select public.get_or_create_direct_conversation($1) id", [b])
  )[0].id;
  assert.equal(
    (
      await sql("select public.get_or_create_direct_conversation($1) id", [b])
    )[0].id,
    cid,
  );
  await assert.rejects(() =>
    sql("update conversation_members set user_id=$1 where conversation_id=$2", [
      c,
      cid,
    ]),
  );
  await assert.rejects(() =>
    sql("update conversation_members set muted=true where conversation_id=$1", [
      cid,
    ]),
  );
  await assert.rejects(() =>
    sql(
      "insert into messages(conversation_id,sender_id,body) values($1,$2,'spoof')",
      [cid, b],
    ),
  );
  const first = (
    await sql(
      "insert into messages(conversation_id,sender_id,body) values($1,$2,'hello') returning *",
      [cid, a],
    )
  )[0];
  await sql("select set_chat_setting($1,'pin',true)", [cid]);
  await sql("select set_chat_setting($1,'theme',true,'moon')", [cid]);
  await sql("select set_chat_setting($1,'archive',true)", [cid]);
  assert.equal(
    (await sql("select * from list_my_direct_chats(false)")).length,
    0,
  );
  assert.equal(
    (await sql("select * from list_my_direct_chats(true)"))[0].pinned,
    true,
  );
  await sql("select set_chat_setting($1,'archive',false)", [cid]);
  await as(b);
  assert.equal((await sql("select * from messages"))[0].body, "hello");
  assert.equal((await sql("select * from conversation_members")).length, 1);
  assert.equal(
    (await sql("select * from list_my_direct_chats(true)"))[0].pinned,
    false,
  );
  assert.equal(
    (await sql("select * from list_my_direct_chats(true)"))[0].dialog_theme,
    "moon",
  );
  const reply = (
    await sql(
      "insert into messages(conversation_id,sender_id,body,reply_to_message_id) values($1,$2,'reply',$3) returning *",
      [cid, b, first.id],
    )
  )[0];
  assert.equal(reply.reply_to_message_id, first.id);
  await sql("select delete_message_for_me($1)", [first.id]);
  assert.equal(
    (await sql("select * from messages where id=$1", [first.id])).length,
    0,
  );
  await as(a);
  assert.equal(
    (await sql("select * from messages where id=$1", [first.id])).length,
    1,
  );
  await as(c);
  assert.equal((await sql("select * from messages")).length, 0);
  assert.equal((await sql("select * from conversations")).length, 0);
  assert.equal(
    (await sql("select is_conversation_member($1,$2) x", [cid, a]))[0].x,
    false,
  );
  assert.equal(
    (await sql("select other_conversation_user($1,$2) x", [cid, a]))[0].x,
    null,
  );
  await assert.rejects(() =>
    sql("select set_chat_setting($1,'pin',true)", [cid]),
  );
  await assert.rejects(() =>
    sql(
      "insert into messages(conversation_id,sender_id,body) values($1,$2,'intrusion')",
      [cid, c],
    ),
  );
  await as(a);
  await sql(
    "insert into drafts(user_id,title,body) values($1,'private','secret')",
    [a],
  );
  await as(b);
  assert.equal((await sql("select * from drafts")).length, 0);
  await sql("insert into blocked_users(blocker_id,blocked_id) values($1,$2)", [
    b,
    a,
  ]);
  await as(a);
  await assert.rejects(() =>
    sql(
      "insert into messages(conversation_id,sender_id,body) values($1,$2,'blocked')",
      [cid, a],
    ),
  );
  assert.equal(
    (await sql("select * from profiles where id=$1", [b])).length,
    0,
  );
  assert.equal(
    (await sql("select * from discover_people(10)")).some((p) => p.id === b),
    false,
  );
  assert.equal((await sql("select * from list_my_friends()")).length, 0);
  assert.equal((await sql("select * from blocked_users")).length, 0);
  assert.equal(
    (await sql("select get_visible_profile($1) p", [b]))[0].p.unavailable,
    true,
  );
  await as(b);
  await sql("delete from blocked_users where blocker_id=$1 and blocked_id=$2", [
    b,
    a,
  ]);
  await as(a);
  await sql("select set_chat_setting($1,'delete',true)", [cid]);
  assert.equal((await sql("select * from messages")).length, 0);
  await as(b);
  assert.equal((await sql("select * from messages")).length, 1);
  const second = (
    await sql(
      "insert into messages(conversation_id,sender_id,body) values($1,$2,'new') returning *",
      [cid, b],
    )
  )[0];
  await as(a);
  assert.equal((await sql("select * from messages")).length, 1);
  assert.equal(
    (await sql("select * from list_my_direct_chats(true)"))[0].unread_count,
    1,
  );
  await sql("select mark_chat_read($1,$2)", [cid, second.id]);
  assert.equal(
    (await sql("select * from list_my_direct_chats(true)"))[0].unread_count,
    0,
  );
  await as(b);
  assert.equal(
    String(
      (await sql("select * from list_my_direct_chats(true)"))[0]
        .peer_last_read_at,
    ),
    String(second.created_at),
  );
  await as(a);
  await assert.rejects(() => sql("select delete_my_message($1)", [second.id]));
  await as(b);
  await sql("select delete_my_message($1)", [second.id]);
  await as(a);
  assert.ok((await sql("select * from messages"))[0].deleted_at);
  // Storage policies and private avatar history, using the actual policies from the migration.
  const avatarPath = a + "/avatar-one";
  await sql(
    'insert into storage.objects(bucket_id,name,metadata) values(\'avatars\',$1,\'{"size":100,"mimetype":"image/png"}\')',
    [avatarPath],
  );
  const avatar = (
    await sql("select * from register_avatar($1,$2)", [
      avatarPath,
      "https://example.invalid/storage/v1/object/public/avatars/" + avatarPath,
    ])
  )[0];
  await as(b);
  assert.equal((await sql("select * from profile_avatars")).length, 0);
  assert.equal(
    (await sql("select * from storage.objects where bucket_id='avatars'"))
      .length,
    1,
  );
  await as(a);
  await sql("select select_avatar(null)");
  await as(b);
  assert.equal(
    (await sql("select * from storage.objects where bucket_id='avatars'"))
      .length,
    0,
  );
  await as(a);
  await sql("select select_avatar($1)", [avatar.id]);
  await as(b);
  assert.equal(
    (await sql("select * from storage.objects where bucket_id='avatars'"))
      .length,
    1,
  );
  assert.equal((await sql("select * from profile_avatars")).length, 0);
  await as(a);
  await assert.rejects(() =>
    sql("update profiles set avatar_url=$1 where id=$2", [
      "https://evil.invalid",
      a,
    ]),
  );
  const path = a + "/" + cid + "/test-file";
  await sql(
    'insert into storage.objects(bucket_id,name,metadata) values(\'attachments\',$1,\'{"size":100,"mimetype":"image/png"}\')',
    [path],
  );
  const attachment = (
    await sql(
      "insert into messages(conversation_id,sender_id,body,attachment_path,attachment_name) values($1,$2,'',$3,'picture.png') returning *",
      [cid, a, path],
    )
  )[0];
  assert.equal(attachment.attachment_size, 100);
  await as(b);
  assert.equal(
    (await sql("select * from storage.objects where bucket_id='attachments'"))
      .length,
    1,
  );
  await as(c);
  assert.equal(
    (await sql("select * from storage.objects where bucket_id='attachments'"))
      .length,
    0,
  );
  await assert.rejects(() =>
    sql(
      "insert into storage.objects(bucket_id,name,metadata) values('attachments',$1,'{}')",
      [c + "/" + cid + "/intrusion"],
    ),
  );
  await as(a);
  await sql("select delete_my_message($1)", [attachment.id]);
  await as(b);
  assert.equal(
    (await sql("select * from storage.objects where bucket_id='attachments'"))
      .length,
    0,
  );
  // Avatar history remains owner-only and cannot be mutated by another account.
  await as(b);
  await assert.rejects(() => sql("select select_avatar($1)", [avatar.id]));
  await sql("insert into blocked_users(blocker_id,blocked_id) values($1,$2)", [
    b,
    a,
  ]);
  assert.equal((await sql("select * from profile_avatars")).length, 0);
  assert.equal(
    (await sql("select * from storage.objects where bucket_id='avatars'"))
      .length,
    0,
  );
  await sql("delete from blocked_users where blocker_id=$1", [b]);
  const reportId = (
    await sql("select submit_report($1,$2,$3) id", [
      a,
      attachment.id,
      "Нежелательное сообщение",
    ])
  )[0].id;
  assert.ok(reportId);
  await assert.rejects(() => sql("select * from reports"));
  await assert.rejects(() =>
    sql("select submit_report($1,null,$2)", [b, "Жалоба на самого себя"]),
  );
  for (let i = 0; i < 4; i++)
    await sql("select submit_report($1,null,$2)", [
      a,
      "Повторяющееся нарушение номер " + i,
    ]);
  await assert.rejects(() =>
    sql("select submit_report($1,null,$2)", [a, "Шестая жалоба за один час"]),
  );
  await as(a);
  await sql("update profiles set interests=$1,interest_colors=$2 where id=$3", [
    ["Design"],
    { Design: "green" },
    a,
  ]);
  await assert.rejects(() =>
    sql("update profiles set interest_colors=$1 where id=$2", [
      { Design: "url(evil)" },
      a,
    ]),
  );
  await assert.rejects(() =>
    sql("update profiles set interest_colors=$1 where id=$2", [
      { Hidden: "green" },
      a,
    ]),
  );
  const bg = a + "/" + cid + "/background";
  await sql(
    "insert into storage.objects(bucket_id,name) values('dialog-backgrounds',$1)",
    [bg],
  );
  await sql("select set_dialog_background($1,$2)", [cid, bg]);
  assert.equal(
    (await sql("select background_path from conversation_appearance"))[0]
      .background_path,
    bg,
  );
  await as(b);
  assert.equal(
    (await sql("select background_path from conversation_appearance"))[0]
      .background_path,
    bg,
  );
  assert.equal(
    (
      await sql(
        "select * from storage.objects where bucket_id='dialog-backgrounds'",
      )
    ).length,
    1,
  );
  await assert.rejects(() =>
    sql("select set_dialog_background($1,$2)", [cid, bg]),
  );
  await as(c);
  await assert.rejects(() =>
    sql("select set_dialog_background($1,null)", [cid]),
  );
  await as(a);
  await sql("select set_dialog_background($1,null)", [cid]);
  assert.equal(
    (await sql("select background_path from conversation_appearance"))[0]
      .background_path,
    null,
  );
  await db.exec("reset role;set role anon");
  await assert.rejects(() => sql("select * from list_my_direct_chats(true)"));
  await assert.rejects(() => sql("select * from discover_people(10)"));
  await db.close();
});
