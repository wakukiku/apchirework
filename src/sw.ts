/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { createHandlerBoundToURL } from "workbox-precaching";
import { NetworkOnly } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<never> };

type PushPayload = {
  title?: string;
  body?: string;
  conversation_id?: string;
  url?: string;
};

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
  registerRoute(
    ({ url }: { url: URL }) => url.hostname.endsWith(".supabase.co"),
    new NetworkOnly(),
    method,
  );
}

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/functions\//],
  }),
);

self.addEventListener("push", (event: PushEvent) => {
  event.waitUntil(
    (async () => {
      let payload: PushPayload = {};
      const raw = event.data?.text() ?? "";
      if (raw) {
        try {
          payload = JSON.parse(raw) as PushPayload;
        } catch {
          payload = { body: raw };
        }
      }

      const path =
        typeof payload.url === "string" &&
        /^\/chats\/[0-9a-f-]+$/i.test(payload.url)
          ? payload.url
          : "/chats";

      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      const exactVisibleChat = windows.some((client) => {
        try {
          return (
            client.visibilityState === "visible" &&
            new URL(client.url).origin === self.location.origin &&
            new URL(client.url).pathname === path
          );
        } catch {
          return false;
        }
      });

      if (exactVisibleChat) return;

      await self.registration.showNotification(payload.title || "Apchi", {
        body: payload.body || "Новое сообщение",
        icon: "/pwa-192x192.png",
        badge: "/pwa-192x192.png",
        tag: payload.conversation_id
          ? `apchi:${payload.conversation_id}`
          : "apchi:message",
        data: { url: path },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url;
  if (typeof path !== "string" || !/^\/chats(?:\/[0-9a-f-]+)?$/i.test(path))
    return;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        const url = new URL(path, self.location.origin).href;
        const client = windows.find(
          (item) => new URL(item.url).origin === self.location.origin,
        );
        if (client) {
          await client.navigate(url);
          return client.focus();
        }
        return self.clients.openWindow(url);
      }),
  );
});
