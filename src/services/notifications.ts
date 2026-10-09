import type { ChatSummary } from "../types";
let audio: AudioContext | undefined;
export function prepareSound() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume().catch(() => {});
  } catch {
    /* Audio is optional. */
  }
}
export function notificationEnabled(uid: string) {
  try {
    return localStorage.getItem("apchi-notify:" + uid) === "yes";
  } catch {
    return false;
  }
}
export async function toggleNotifications(uid: string) {
  if (!("Notification" in window))
    throw new Error("Этот браузер не поддерживает уведомления.");
  const enabled = notificationEnabled(uid);
  if (enabled) {
    localStorage.setItem("apchi-notify:" + uid, "no");
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      "Уведомления не разрешены. Изменить разрешение можно в настройках сайта.",
    );
  localStorage.setItem("apchi-notify:" + uid, "yes");
  prepareSound();
  return true;
}
export async function notifyMessage(
  uid: string,
  chat: ChatSummary,
  open: () => void,
) {
  if (!notificationEnabled(uid)) return;
  // Cross-tab deduplication: only one visible notification/sound per conversation update.
  const key = "apchi-notified:" + uid + ":" + chat.conversation_id;
  const value = chat.last_message_at ?? "";
  try {
    if (localStorage.getItem(key) === value) return;
    localStorage.setItem(key, value);
  } catch {}
  try {
    if (audio?.state === "running") {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.frequency.setValueAtTime(660, audio.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        880,
        audio.currentTime + 0.12,
      );
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.06, audio.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.22);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.23);
    }
    if ("Notification" in window && Notification.permission === "granted") {
      const options = {
        body: "Новое сообщение",
        icon: "/pwa-192x192.png",
        badge: "/pwa-192x192.png",
        tag: "apchi:" + chat.conversation_id,
        data: { url: "/chats/" + chat.conversation_id },
      };
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.showNotification(chat.display_name, options);
          return;
        }
      }
      const n = new Notification(chat.display_name, options);
      n.onclick = () => {
        window.focus();
        open();
        n.close();
      };
    }
  } catch {
    /* Unsupported notification/audio APIs do not interrupt messages. */
  }
}
