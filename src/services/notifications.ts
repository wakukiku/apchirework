import { supabase } from "../lib/supabase";
import type { ChatSummary } from "../types";

let audio: AudioContext | undefined;

function settingKey(uid: string) {
  return "apchi-notify:" + uid;
}

function vapidPublicKey() {
  return String(import.meta.env.VITE_VAPID_PUBLIC_KEY ?? "").trim();
}

function pushSupported() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    window.isSecureContext
  );
}

function base64UrlToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function registerSubscription(uid: string) {
  if (!pushSupported()) return null;
  const key = vapidPublicKey();
  if (!key) return null;

  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(key),
    });
  }

  const payload = subscription.toJSON();
  const p256dh = payload.keys?.p256dh;
  const auth = payload.keys?.auth;
  if (!p256dh || !auth) {
    await subscription.unsubscribe().catch(() => false);
    throw new Error("Не удалось создать push-подписку.");
  }

  const { error } = await supabase.rpc("register_push_subscription", {
    push_endpoint: subscription.endpoint,
    p256dh_key: p256dh,
    auth_secret: auth,
    client_user_agent: navigator.userAgent,
  });
  if (error) {
    await subscription.unsubscribe().catch(() => false);
    throw error;
  }

  localStorage.setItem(settingKey(uid), "yes");
  return subscription;
}

async function unregisterCurrentSubscription() {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready.catch(() => null);
  if (!registration || !("pushManager" in registration)) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  try {
    await supabase.rpc("unregister_push_subscription", {
      push_endpoint: subscription.endpoint,
    });
  } finally {
    await subscription.unsubscribe().catch(() => false);
  }
}

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
    return localStorage.getItem(settingKey(uid)) === "yes";
  } catch {
    return false;
  }
}

export async function syncPushSubscription(uid: string) {
  if (!notificationEnabled(uid)) return false;
  if (!("Notification" in window) || Notification.permission !== "granted") {
    localStorage.setItem(settingKey(uid), "no");
    return false;
  }
  if (pushSupported() && vapidPublicKey()) {
    try {
      await registerSubscription(uid);
    } catch (error) {
      localStorage.setItem(settingKey(uid), "no");
      throw error;
    }
  }
  return true;
}

export async function detachPushSubscription() {
  try {
    await unregisterCurrentSubscription();
  } catch {
    // Logout must still complete. Unsubscribing locally invalidates the endpoint.
  }
}

export async function toggleNotifications(uid: string) {
  if (!("Notification" in window))
    throw new Error("Этот браузер не поддерживает уведомления.");

  if (notificationEnabled(uid)) {
    localStorage.setItem(settingKey(uid), "no");
    await unregisterCurrentSubscription();
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      "Уведомления не разрешены. Изменить разрешение можно в настройках сайта.",
    );

  if (pushSupported() && vapidPublicKey()) await registerSubscription(uid);
  else localStorage.setItem(settingKey(uid), "yes");

  prepareSound();
  return true;
}

async function hasPushSubscription() {
  if (!pushSupported() || !vapidPublicKey()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(await registration.pushManager.getSubscription());
  } catch {
    return false;
  }
}

export async function notifyMessage(
  uid: string,
  chat: ChatSummary,
  open: () => void,
) {
  if (!notificationEnabled(uid)) return;

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

    // A real push subscription means the service worker will create the persistent
    // system notification. Avoid a second foreground notification here.
    if (await hasPushSubscription()) return;

    if (Notification.permission === "granted") {
      const options = {
        body: "Новое сообщение",
        icon: "/pwa-192x192.png",
        badge: "/notification-badge.png",
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
      const notification = new Notification(chat.display_name, options);
      notification.onclick = () => {
        window.focus();
        open();
        notification.close();
      };
    }
  } catch {
    /* Unsupported notification/audio APIs do not interrupt messages. */
  }
}
