self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.url;
  if (typeof path !== "string" || !/^\/chats\/[0-9a-f-]+$/i.test(path)) return;
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        const url = new URL(path, self.location.origin).href;
        const client = windows.find(
          (w) => new URL(w.url).origin === self.location.origin,
        );
        if (client) {
          await client.navigate(url);
          return client.focus();
        }
        return clients.openWindow(url);
      }),
  );
});
