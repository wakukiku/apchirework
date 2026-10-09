import type { Message } from "../types";

export function errorText(error: unknown) {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "";
  if (/fetch|network/i.test(message))
    return "Нет соединения. Проверьте интернет и повторите.";
  if (/duplicate|unique/i.test(message))
    return "Это имя пользователя уже занято.";
  if (/invalid login credentials/i.test(message))
    return "Неверный email или пароль.";
  if (/email not confirmed/i.test(message))
    return "Сначала подтвердите email по ссылке из письма.";
  if (/user already registered/i.test(message))
    return "Аккаунт с таким email уже зарегистрирован.";
  if (/rate limit|too many requests|слишком много/i.test(message))
    return "Слишком много запросов. Подождите немного и повторите.";
  if (/captcha/i.test(message))
    return "Не удалось пройти защитную проверку. Обновите её и повторите.";
  return message || "Не удалось выполнить действие. Попробуйте ещё раз.";
}
export function mergeMessages(current: Message[], incoming: Message[]) {
  const map = new Map(current.map((item) => [item.id, item]));
  incoming.forEach((item) => map.set(item.id, item));
  return [...map.values()].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}
export function firstUnread(
  messages: Message[],
  userId: string,
  readAt: string | null,
) {
  return messages.find(
    (m) =>
      m.sender_id !== userId &&
      !m.deleted_at &&
      (!readAt || m.created_at > readAt),
  );
}
export function isNearBottom(top: number, height: number, viewport: number) {
  return height - top - viewport < 100;
}
export function safeLink(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
export const attachmentTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];
export function validateAttachment(file: { type: string; size: number }) {
  if (!attachmentTypes.includes(file.type))
    throw new Error(
      "Поддерживаются JPG, PNG, WebP, GIF, PDF, TXT, CSV, ZIP и документы Office.",
    );
  if (file.size <= 0 || file.size > 20 * 1024 * 1024)
    throw new Error("Размер файла должен быть от 1 байта до 20 МБ.");
}
export function shouldNotify({
  own,
  active,
  muted,
  blocked,
}: {
  own: boolean;
  active: boolean;
  muted: boolean;
  blocked: boolean;
}) {
  return !own && !active && !muted && !blocked;
}
export function storageRead(key: string) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
export function storageWrite(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* Storage may be disabled by the browser. */
  }
}
