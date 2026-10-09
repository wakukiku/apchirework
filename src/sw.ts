/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { clientsClaim } from "workbox-core";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { createHandlerBoundToURL } from "workbox-precaching";
import { NetworkOnly } from "workbox-strategies";
declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<never> };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(
  ({ url }) => url.hostname.endsWith(".supabase.co"),
  new NetworkOnly(),
  "GET",
);
registerRoute(
  ({ url }) => url.hostname.endsWith(".supabase.co"),
  new NetworkOnly(),
  "POST",
);
registerRoute(
  ({ url }) => url.hostname.endsWith(".supabase.co"),
  new NetworkOnly(),
  "PUT",
);
registerRoute(
  ({ url }) => url.hostname.endsWith(".supabase.co"),
  new NetworkOnly(),
  "PATCH",
);
registerRoute(
  ({ url }) => url.hostname.endsWith(".supabase.co"),
  new NetworkOnly(),
  "DELETE",
);
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("index.html"), {
    denylist: [/^\/functions\//],
  }),
);
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url;
  if (typeof path !== "string" || !/^\/chats\/[0-9a-f-]+$/i.test(path)) return;
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
