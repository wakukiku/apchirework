import { supabase } from "../lib/supabase";
import { currentUser } from "../lib/currentUser";
export async function getBackground(cid: string) {
  const { data, error } = await supabase
    .from("dialog_backgrounds")
    .select("storage_path")
    .eq("conversation_id", cid)
    .maybeSingle();
  if (error) throw error;
  return (data?.storage_path as string | undefined) ?? null;
}
export async function backgroundUrl(path: string) {
  const { data, error } = await supabase.storage
    .from("dialog-backgrounds")
    .createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
export async function saveBackground(
  cid: string,
  file: File | null,
  previous: string | null,
) {
  let path: string | null = null;
  if (file) {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      !file.size ||
      file.size > 8388608
    )
      throw new Error("Выберите JPG, PNG или WebP размером до 8 МБ.");
    // Bound texture size and transfer cost before storing a background on mobile.
    const bitmap = await createImageBitmap(file);
    let optimized: Blob;
    try {
      if (bitmap.width * bitmap.height > 40000000)
        throw new Error(
          "Изображение слишком большое: выберите файл до 40 мегапикселей.",
        );
      const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Браузер не смог обработать изображение.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      optimized = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(new Error("Не удалось обработать изображение.")),
          "image/webp",
          0.85,
        ),
      );
    } finally {
      bitmap.close();
    }
    const user = await currentUser();
    path = `${user.id}/${cid}/${crypto.randomUUID()}`;
    const { error } = await supabase.storage
      .from("dialog-backgrounds")
      .upload(path, optimized, { contentType: optimized.type, upsert: false });
    if (error) throw error;
  }
  const { error } = await supabase.rpc("set_dialog_background", { cid, path });
  if (error) {
    if (path) await supabase.storage.from("dialog-backgrounds").remove([path]);
    throw error;
  }
  if (previous)
    await supabase.storage.from("dialog-backgrounds").remove([previous]);
  return path;
}
