import { supabase } from "../lib/supabase";
import type { Profile, ProfileAvatar, Friend, DiscoveredUser } from "../types";
import { currentUser } from "../lib/currentUser";
let profileEpoch = 0;
function invalidateProfile() {
  profileEpoch++;
  profileCache = undefined;
  profileRequest = undefined;
}
let profileCache: { id: string; expires: number; value: Profile } | undefined;
let profileRequest: { id: string; promise: Promise<Profile> } | undefined;
const signedAvatars = new Map<
  string,
  { expires: number; promise: Promise<string | null> }
>();
supabase.auth.onAuthStateChange(() => {
  invalidateProfile();
  signedAvatars.clear();
});

async function fetchMyProfile() {
  const user = await currentUser();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (error) throw error;
  return data as Profile;
}
export async function getMyProfile() {
  const user = await currentUser();
  if (profileCache?.id === user.id && profileCache.expires > Date.now())
    return profileCache.value;
  if (profileRequest?.id === user.id) return profileRequest.promise;
  const epoch = profileEpoch;
  const promise = fetchMyProfile()
    .then((value) => {
      if (epoch === profileEpoch)
        profileCache = { id: user.id, expires: Date.now() + 15000, value };
      return value;
    })
    .finally(() => {
      if (profileRequest?.promise === promise) profileRequest = undefined;
    });
  profileRequest = { id: user.id, promise };
  return promise;
}
export async function updateMyProfile(
  patch: Partial<
    Pick<
      Profile,
      | "display_name"
      | "username"
      | "bio"
      | "city"
      | "status_text"
      | "interests"
      | "interest_colors"
    >
  >,
) {
  const user = await currentUser();
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", user.id)
    .select("*")
    .single();
  if (error) throw error;
  invalidateProfile();
  profileCache = {
    id: user.id,
    expires: Date.now() + 15000,
    value: data as Profile,
  };
  return data as Profile;
}
export async function discoverPeople(limit = 10) {
  const { data, error } = await supabase.rpc("discover_people", {
    limit_count: limit,
  });
  if (error) throw error;
  return (data ?? []) as DiscoveredUser[];
}
export async function listFriends() {
  const { data, error } = await supabase.rpc("list_my_friends");
  if (error) throw error;
  return (data ?? []) as Friend[];
}
export async function getProfileById(userId: string) {
  const { data, error } = await supabase.rpc("get_visible_profile", {
    target: userId,
  });
  if (error) throw error;
  return data as Profile & { blocked_by_me: boolean; unavailable: boolean };
}
export async function listMyAvatars() {
  return listAvatars((await currentUser()).id);
}
async function listAvatars(userId: string) {
  const { data, error } = await supabase
    .from("profile_avatars")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProfileAvatar[];
}
export async function avatarUrl(canonical: string) {
  const user = await currentUser();
  const key = user.id + ":" + canonical;
  const cached = signedAvatars.get(key);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = signAvatar(canonical).catch((error) => {
    signedAvatars.delete(key);
    throw error;
  });
  if (signedAvatars.size > 200) signedAvatars.clear();
  signedAvatars.set(key, { expires: Date.now() + 45000, promise });
  return promise;
}
async function signAvatar(canonical: string) {
  const marker = "/storage/v1/object/public/avatars/";
  const i = canonical.indexOf(marker);
  if (i < 0) return null;
  const path = decodeURIComponent(canonical.slice(i + marker.length));
  const { data, error } = await supabase.storage
    .from("avatars")
    .createSignedUrl(path, 60);
  if (error) throw error;
  return data.signedUrl;
}
export async function uploadAvatar(file: File) {
  const user = await currentUser();
  if (
    !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)
  )
    throw new Error("Выберите JPG, PNG, WebP или GIF.");
  if (file.size <= 0 || file.size > 5242880)
    throw new Error("Максимальный размер аватара — 5 МБ.");
  const path = `${user.id}/${crypto.randomUUID()}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  const url = supabase.storage.from("avatars").getPublicUrl(path)
    .data.publicUrl;
  const result = await supabase.rpc("register_avatar", {
    path,
    canonical_url: url,
  });
  if (result.error) {
    await supabase.storage.from("avatars").remove([path]);
    throw result.error;
  }
  invalidateProfile();
  return result.data as ProfileAvatar;
}
export async function chooseAvatar(avatar: ProfileAvatar | null) {
  const { error } = await supabase.rpc("select_avatar", {
    avatar_id: avatar?.id ?? null,
  });
  if (error) throw error;
  invalidateProfile();
}
export async function deleteAvatar(avatar: ProfileAvatar) {
  const { error } = await supabase.rpc("remove_avatar", {
    avatar_id: avatar.id,
  });
  if (error) throw error;
  const result = await supabase.storage
    .from("avatars")
    .remove([avatar.storage_path]);
  if (result.error)
    throw new Error(
      "Аватар убран из галереи, но очистка файла не завершилась. Повторите удаление в Storage.",
    );
  invalidateProfile();
  return (await getMyProfile()).avatar_url;
}
