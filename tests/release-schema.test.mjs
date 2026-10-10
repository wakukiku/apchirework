import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("consolidated release schema installs on an empty database", async () => {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public,storage to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,created_at timestamptz default now(),unique(bucket_id,name));
 alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
 grant all on all tables in schema storage to authenticated;alter default privileges in schema public grant all on tables to authenticated,anon;create publication supabase_realtime;`);
  let source = await readFile(
    new URL("../supabase/schema.sql", import.meta.url),
    "utf8",
  );
  source = source.replace("create extension if not exists pgcrypto;", "");
  await db.exec(source);
  const names = (
    await db.query("select tablename from pg_tables where schemaname='public'")
  ).rows.map((r) => r.tablename);
  for (const expected of [
    "profiles",
    "messages",
    "drafts",
    "reports",
    "conversation_appearance",
    "conversation_read_receipts",
    "message_hidden_users",
    "push_subscriptions",
    "push_delivery_claims",
  ])
    assert.ok(names.includes(expected), expected);
  const functions = (
    await db.query(
      "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'",
    )
  ).rows.map((r) => r.proname);
  for (const expected of [
    "submit_report",
    "set_dialog_background",
    "remove_avatar",
    "register_push_subscription",
    "unregister_push_subscription",
    "delete_message_for_me",
    "delete_message_for_everyone",
  ])
    assert.ok(functions.includes(expected), expected);
  await db.close();
});
