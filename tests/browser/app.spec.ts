import { test, expect, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import AxeBuilder from "@axe-core/playwright";
const me = "10000000-0000-4000-8000-000000000001",
  peer = "10000000-0000-4000-8000-000000000002",
  cid = "20000000-0000-4000-8000-000000000001";
const time = (n: number) =>
  new Date(Date.UTC(2026, 0, 1, 12, 0, n)).toISOString();
const profile = {
  id: me,
  username: "test_one",
  display_name: "Тестовый профиль",
  bio: "",
  city: "",
  status_text: "",
  interests: ["Дизайн"],
  avatar_url: null,
  avatar_color: "#ba8065",
  last_seen_at: null,
  created_at: time(0),
};
async function backend(page: Page, auth = true) {
  let ownProfile = { ...profile };
  let messages = Array.from({ length: 140 }, (_, i) => ({
    id: "30000000-0000-4000-8000-" + String(i + 1).padStart(12, "0"),
    conversation_id: cid,
    sender_id: i % 3 === 0 ? me : peer,
    body: "Сообщение " + (i + 1) + " — проверка истории диалога.",
    created_at: time(i),
    edited_at: null,
    deleted_at: null,
    reply_to_message_id: null,
    reply_to: null,
    attachment_path: null,
    attachment_name: null,
    attachment_type: null,
    attachment_size: null,
  }));
  let chat = {
    conversation_id: cid,
    other_user_id: peer,
    display_name: "Собеседник",
    username: "test_two",
    bio: "",
    avatar_url: null,
    avatar_color: "#8b9d80",
    last_seen_at: new Date().toISOString(),
    last_message: "Последнее сообщение",
    last_message_at: time(139),
    last_read_at: time(79),
    peer_last_read_at: null,
    archived: false,
    pinned: false,
    muted: false,
    dialog_theme: "system",
    unread_count: 40,
    blocked_by_me: false,
    unavailable: false,
  };
  let hidden = false;
  let drafts: any[] = [];
  let block = false;
  let push: (m: any) => void = () => {};
  await page.routeWebSocket(/apchi-test.invalid/, (ws) => {
    ws.onMessage((raw) => {
      const packet = JSON.parse(String(raw));
      const msg = Array.isArray(packet)
        ? {
            join_ref: packet[0],
            ref: packet[1],
            topic: packet[2],
            event: packet[3],
            payload: packet[4],
          }
        : packet;
      const encode = (message: any) =>
        JSON.stringify(
          Array.isArray(packet)
            ? [
                message.join_ref ?? msg.join_ref,
                message.ref ?? null,
                message.topic,
                message.event,
                message.payload,
              ]
            : message,
        );
      if (msg.event === "phx_join") {
        const join = msg;
        ws.send(
          encode({
            topic: msg.topic,
            event: "phx_reply",
            ref: msg.ref,
            payload: {
              status: "ok",
              response: {
                postgres_changes: (
                  msg.payload.config?.postgres_changes ?? []
                ).map((f: any, i: number) => ({ ...f, id: i + 1 })),
              },
            },
          }),
        );
        if (msg.topic.includes("dialog:"))
          push = (m) =>
            ws.send(
              encode({
                topic: join.topic,
                event: "postgres_changes",
                payload: {
                  ids: [1],
                  data: {
                    schema: "public",
                    table: "messages",
                    type: "INSERT",
                    record: m,
                    old_record: {},
                    commit_timestamp: new Date().toISOString(),
                    errors: null,
                    columns: [],
                  },
                },
              }),
            );
      } else if (msg.event === "heartbeat")
        ws.send(
          encode({
            topic: msg.topic,
            event: "phx_reply",
            ref: msg.ref,
            payload: { status: "ok", response: {} },
          }),
        );
    });
  });
  await page.route("https://apchi-test.invalid/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    let body: any = {};
    try {
      body = route.request().postDataJSON() ?? {};
    } catch {}
    let result: any = [];
    let status = 200;
    const single = route
      .request()
      .headers()
      .accept?.includes("vnd.pgrst.object");
    if (path.includes("/auth/v1/signup"))
      result = {
        user: { id: me, email: "new@example.invalid" },
        session: null,
      };
    else if (path.includes("/auth/v1/user"))
      result = { id: me, user_metadata: { username: "test_one" } };
    else if (path.endsWith("/rpc/list_my_direct_chats"))
      result = hidden ? [] : [chat];
    else if (path.endsWith("/rpc/get_or_create_direct_conversation")) {
      hidden = false;
      result = cid;
    } else if (path.endsWith("/rpc/set_chat_setting")) {
      if (body.setting === "theme") chat.dialog_theme = body.theme;
      else if (body.setting === "pin") chat.pinned = body.enabled;
      else if (body.setting === "archive") chat.archived = body.enabled;
      else if (body.setting === "mute") chat.muted = body.enabled;
      else if (body.setting === "delete") {
        hidden = true;
        messages = [];
      }
      result = null;
    } else if (path.endsWith("/rpc/mark_chat_read")) {
      chat.unread_count = 0;
      result = null;
    } else if (path.endsWith("/rpc/get_visible_profile"))
      result = {
        ...profile,
        id: peer,
        username: "test_two",
        display_name: "Собеседник",
        blocked_by_me: block,
        unavailable: block,
      };
    else if (path.endsWith("/rpc/list_blocked_profiles"))
      result = block
        ? [{ id: peer, username: "test_two", display_name: "Собеседник" }]
        : [];
    else if (path.endsWith("/rpc/discover_people"))
      result = [
        {
          ...profile,
          id: peer,
          username: "test_two",
          display_name: "Собеседник",
        },
      ];
    else if (path.endsWith("/rpc/list_my_friends"))
      result = [
        {
          ...profile,
          conversation_id: cid,
          user_id: peer,
          username: "test_two",
          display_name: "Собеседник",
          last_message_at: time(139),
        },
      ];
    else if (path.endsWith("/rpc/delete_message_for_me")) {
      messages = messages.filter((m) => m.id !== body.message_id);
      result = null;
    } else if (path.endsWith("/rpc/delete_message_for_everyone")) {
      messages = messages.filter((m) => m.id !== body.message_id);
      result = null;
    } else if (path.endsWith("/conversation_appearance")) {
      result = single ? null : [];
    } else if (path.endsWith("/profiles")) {
      if (method === "PATCH") ownProfile = { ...ownProfile, ...body };
      result = single ? ownProfile : [ownProfile];
    } else if (path.endsWith("/blocked_users")) {
      block = method === "POST";
      chat.blocked_by_me = block;
      chat.unavailable = block;
      result = null;
    } else if (path.endsWith("/drafts")) {
      if (method === "POST") {
        const d = {
          ...body,
          id: crypto.randomUUID(),
          pinned: false,
          updated_at: time(0),
          created_at: time(0),
        };
        drafts.push(d);
        result = d;
      } else if (method === "PATCH") {
        const id = url.searchParams.get("id")?.slice(3);
        drafts = drafts.map((d) => (d.id === id ? { ...d, ...body } : d));
        result = drafts.find((d) => d.id === id);
      } else if (method === "DELETE") {
        const id = url.searchParams.get("id")?.slice(3);
        drafts = drafts.filter((d) => d.id !== id);
        result = null;
      } else result = drafts;
    } else if (path.endsWith("/messages")) {
      if (method === "POST") {
        const m = {
          ...body,
          created_at: time(300 + messages.length),
          edited_at: null,
          deleted_at: null,
          reply_to: body.reply_to_message_id
            ? (messages.find((item) => item.id === body.reply_to_message_id) ??
              null)
            : null,
        };
        messages.push(m);
        result = m;
      } else {
        let list = [...messages];
        if (url.searchParams.has("body")) {
          const term = url.searchParams
            .get("body")!
            .replace("ilike.%", "")
            .slice(0, -1);
          list = list.filter((m) => m.body.includes(term));
        }
        if (url.searchParams.has("attachment_path"))
          list = list.filter((m) => m.attachment_path);
        if (url.searchParams.has("id"))
          list = list.filter(
            (m) => m.id === url.searchParams.get("id")!.slice(3),
          );
        const after = url.searchParams.get("created_at")?.replace("gte.", "");
        if (after) list = list.filter((m) => m.created_at >= after);
        const before = url.searchParams
          .get("or")
          ?.match(/created_at.lt.([^,]+)/)?.[1];
        if (before) list = list.filter((m) => m.created_at < before);
        const limit = Number(url.searchParams.get("limit") ?? 100);
        list.sort((a, b) =>
          url.searchParams.get("order")?.includes("created_at.asc")
            ? a.created_at.localeCompare(b.created_at)
            : b.created_at.localeCompare(a.created_at),
        );
        result = single
          ? (list[0] ?? null)
          : list.slice(
              Number(url.searchParams.get("offset") ?? 0),
              Number(url.searchParams.get("offset") ?? 0) + limit,
            );
      }
    } else if (path.includes("/storage/v1/object/sign/"))
      result = { signedURL: "/object/sign/attachments/test" };
    else if (path.includes("/storage/v1/object/"))
      result = { Key: "attachments/test" };
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  if (auth)
    await page.addInitScript(
      ({ me }) => {
        const token =
          btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) +
          "." +
          btoa(
            JSON.stringify({
              sub: me,
              role: "authenticated",
              exp: Math.floor(Date.now() / 1000) + 3600,
            }),
          ) +
          ".test";
        localStorage.setItem(
          "sb-apchi-test-auth-token",
          JSON.stringify({
            access_token: token,
            refresh_token: "test-refresh",
            token_type: "bearer",
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: {
              id: me,
              user_metadata: { username: "test_one" },
              aud: "authenticated",
              role: "authenticated",
            },
          }),
        );
      },
      { me },
    );
  return {
    receive: () => {
      const m = {
        ...messages.at(-1),
        id: crypto.randomUUID(),
        sender_id: peer,
        body: "Новое входящее сообщение",
        created_at: time(999),
      };
      messages.push(m as any);
      push(m);
    },
    chat: () => chat,
  };
}
test("auth registration has a dedicated confirmation screen", async ({
  page,
}) => {
  await backend(page, false);
  await page.goto("/");
  await page.getByRole("button", { name: "Регистрация", exact: true }).click();
  await page.getByLabel("Имя", { exact: true }).fill("Новый");
  await page.getByLabel("Имя пользователя", { exact: true }).fill("new_user");
  await page.getByLabel("Email", { exact: true }).fill("new@example.invalid");
  await page.getByLabel("Пароль", { exact: true }).fill("only-for-test");
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(
    page.getByRole("heading", { name: "Подтвердите почту" }),
  ).toBeVisible();
});
test("public policy, terms, safety and account deletion routes open directly", async ({
  page,
}) => {
  await backend(page, false);
  for (const [path, title] of [
    ["/privacy", "Политика конфиденциальности"],
    ["/terms", "Условия использования"],
    ["/safety", "Безопасность в Apchi"],
    ["/delete-account", "Удаление аккаунта"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await expect(
    page.getByRole("link", { name: "Перейти ко входу" }),
  ).toBeVisible();
});

test("account deletion requires two confirmations and calls the server function", async ({
  page,
}) => {
  await backend(page);
  let called = false;
  await page.route("**/functions/v1/delete-account", async (route) => {
    called = true;
    await route.fulfill({ json: { deleted: true } });
  });
  await page.goto("/delete-account");
  await page.getByRole("button", { name: "Начать удаление" }).click();
  await expect(
    page.getByRole("button", { name: "Удалить аккаунт навсегда" }),
  ).toBeDisabled();
  await page.getByLabel("Для подтверждения введите УДАЛИТЬ").fill("УДАЛИТЬ");
  await page.getByRole("button", { name: "Удалить аккаунт навсегда" }).click();
  await expect.poll(() => called).toBe(true);
});
test("chat themes, scroll preservation, send focus, management and browser Back", async ({
  page,
}) => {
  await backend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chats");
  await page.locator(".chat-row").click();
  await expect(page.locator(".message")).toHaveCount(61);
  const first = page.locator(
    '[data-message="30000000-0000-4000-8000-000000000081"]',
  );
  await expect(first).toBeInViewport();
  await page.locator(".messages").evaluate((n) => {
    n.scrollTop = 350;
  });
  const saved = await page.locator(".messages").evaluate((n) => n.scrollTop);
  await page.getByRole("button", { name: "Назад к чатам" }).click();
  await page.locator(".chat-row").click();
  await expect
    .poll(() => page.locator(".messages").evaluate((n) => n.scrollTop))
    .toBe(saved);
  await page.getByRole("button", { name: "Тема диалога" }).click();
  await page.getByRole("button", { name: "Сумерки" }).click();
  await expect(page.locator(".conversation-panel")).toHaveAttribute(
    "data-dialog-theme",
    "twilight",
  );
  await expect
    .poll(() =>
      page
        .locator(".conversation-panel")
        .evaluate((n) => getComputedStyle(n).backgroundColor),
    )
    .toBe("rgb(48, 38, 56)");
  await page.getByRole("button", { name: "Поиск по сообщениям" }).click();
  await page
    .getByRole("textbox", { name: "Найти в диалоге" })
    .fill("Сообщение 1 —");
  await expect(page.locator(".search-results article")).toHaveCount(1);
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Сообщение", exact: true })
    .fill("Моё сообщение");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Сообщение", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".message-body").last()).toHaveText(
    "Моё сообщение",
  );
  await page.getByRole("button", { name: "Действия с чатом" }).click();
  await page.getByRole("button", { name: "Закрепить", exact: true }).click();
  await page.getByRole("button", { name: "Действия с чатом" }).click();
  await expect(
    page.getByRole("button", { name: "Открепить", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Архивировать", exact: true }).click();
  await page.getByRole("button", { name: "Назад к чатам" }).click();
  await page.getByRole("link", { name: "Архив", exact: true }).click();
  await expect(page.locator(".chat-row")).toHaveCount(1);
  await page.locator(".row-menu").click();
  await page.getByRole("button", { name: "Вернуть из архива" }).click();
  await expect(page.locator(".chat-row")).toHaveCount(0);
  await page.getByRole("link", { name: "Чаты", exact: true }).click();
  await page.locator(".chat-row").click();
  await page.goBack();
  await expect(page).toHaveURL(/\/chats$/);
});
test("delete chat then optional block, unblock from profile", async ({
  page,
}) => {
  await backend(page);
  await page.goto("/chats");
  await page.locator(".row-menu").click();
  await page.getByRole("button", { name: "Удалить чат для себя" }).click();
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Заблокировать пользователя?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Заблокировать", exact: true })
    .click();
  await page.goto("/blocked");
  await expect(
    page.getByRole("button", { name: "Разблокировать", exact: true }),
  ).toBeVisible();
  await page.locator(".blocked-list a").click();
  await page
    .getByRole("button", { name: "Разблокировать", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Написать", exact: true }),
  ).toBeVisible();
});
test("draft checklist persists edits, pin and delete", async ({ page }) => {
  await backend(page);
  await page.goto("/drafts");
  await page.getByRole("button", { name: "Новая заметка" }).click();
  await page.getByRole("button", { name: "Чек-лист", exact: true }).click();
  await page.getByLabel("Название").fill("Покупки");
  await page.getByLabel("Каждый пункт с новой строки").fill("Хлеб\nМолоко");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.getByRole("checkbox", { name: "Хлеб" }).check();
  await expect(page.getByRole("checkbox", { name: "Хлеб" })).toBeChecked();
  await page.getByRole("button", { name: "Редактировать заметку" }).click();
  await page.getByLabel("Название").fill("Новый список");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Новый список" }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Хлеб" })).toBeChecked();
  await page.getByRole("button", { name: "Закрепить заметку" }).click();
  await expect(
    page.getByRole("button", { name: "Открепить заметку" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Удалить заметку" }).click();
  await page.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(page.getByText("Черновик пуст")).toBeVisible();
});
for (const width of [360, 375, 390, 412, 430, 768, 1440])
  test("responsive " + width, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await backend(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/chats/" + cid);
    await expect(page.locator(".message")).toHaveCount(61);
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "Открыть меню профиля" }).click();
      await page
        .getByRole("button", {
          name: theme === "light" ? "Светлая тема" : "Тёмная тема",
          exact: true,
        })
        .click();
      await page.keyboard.press("Escape");
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(
        page.getByRole("button", { name: "Отправить", exact: true }),
      ).toBeInViewport();
      await page.screenshot({
        path: testInfo.outputPath(theme + ".png"),
        fullPage: true,
      });
      for (const label of ["Крем", "Сумерки", "Шалфей", "Вишня", "Луна"]) {
        await page.getByRole("button", { name: "Тема диалога" }).click();
        await page.getByRole("button", { name: label, exact: true }).click();
        const colors = await page
          .locator(".conversation-panel")
          .evaluate((n) => ({
            bg: getComputedStyle(n).backgroundColor,
            fg: getComputedStyle(n).color,
          }));
        expect(colors.bg).not.toBe(colors.fg);
      }
    }
    expect(errors).toEqual([]);
  });

test("incoming messages do not move a reader; attachments use Storage", async ({
  page,
}) => {
  const server = await backend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chats/" + cid);
  await expect(page.locator(".message")).toHaveCount(61);
  await page.locator(".messages").evaluate((n) => {
    n.scrollTop = 500;
    n.dispatchEvent(new Event("scroll"));
  });
  const top = await page.locator(".messages").evaluate((n) => n.scrollTop);
  server.receive();
  await expect(
    page.getByText("Новое входящее сообщение", { exact: true }),
  ).toBeAttached();
  expect(await page.locator(".messages").evaluate((n) => n.scrollTop)).toBe(
    top,
  );
  await page
    .getByRole("button", { name: "Новые сообщения", exact: true })
    .click();
  await expect(
    page.getByText("Новое входящее сообщение", { exact: true }),
  ).toBeInViewport();
  await page.locator("input[type=file]").setInputFiles({
    name: "document.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 test"),
  });
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.locator(".attachment-download")).toHaveCount(1);
  await page.getByRole("button", { name: "Медиа и файлы" }).click();
  await expect(page.locator("dialog .attachment-download")).toHaveCount(1);
});

test("message reply, swipe and long-press actions work on mobile", async ({
  page,
}) => {
  await backend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chats/" + cid);
  await expect(page.locator(".main-nav")).toBeHidden();

  const target = page.locator(".message.theirs").last();
  const targetId = await target.getAttribute("data-message");
  await target.getByRole("button", { name: "Действия с сообщением" }).click();
  await page.getByRole("button", { name: "Ответить", exact: true }).click();
  await expect(page.locator(".selected-reply")).toContainText("Собеседник");
  await page.getByRole("textbox", { name: "Сообщение" }).fill("Ответ");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();

  const sent = page.locator(".message.mine").last();
  await expect(sent.locator(".message-reply-quote")).toBeVisible();
  await expect(sent.getByLabel("Отправлено")).toBeVisible();
  await sent.locator(".message-reply-quote").click();
  await expect(page.locator(`[data-message="${targetId}"]`)).toHaveClass(
    /message-highlighted/,
  );

  await target.dispatchEvent("pointerdown", {
    pointerType: "touch",
    pointerId: 11,
    button: 0,
    clientX: 260,
    clientY: 420,
  });
  await target.dispatchEvent("pointermove", {
    pointerType: "touch",
    pointerId: 11,
    button: 0,
    clientX: 180,
    clientY: 420,
  });
  await target.dispatchEvent("pointerup", {
    pointerType: "touch",
    pointerId: 11,
    button: 0,
    clientX: 180,
    clientY: 420,
  });
  await expect(page.locator(".selected-reply")).toBeVisible();
  await page.getByRole("button", { name: "Отменить ответ" }).click();

  await sent.dispatchEvent("pointerdown", {
    pointerType: "touch",
    pointerId: 12,
    button: 0,
    clientX: 250,
    clientY: 500,
  });
  await page.waitForTimeout(560);
  await sent.dispatchEvent("pointerup", {
    pointerType: "touch",
    pointerId: 12,
    button: 0,
    clientX: 250,
    clientY: 500,
  });
  await expect(
    page.getByRole("heading", { name: "Действия с сообщением" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Удалить у меня", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Удалить у всех", exact: true }),
  ).toBeVisible();
});

test("mobile long press opens actions and drag cancels it", async ({
  page,
}) => {
  await backend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chats");
  const row = page.locator(".chat-row");
  await expect(row).toBeVisible();
  await row.dispatchEvent("pointerdown", {
    pointerType: "touch",
    clientX: 100,
    clientY: 200,
  });
  await expect(
    page.getByRole("heading", { name: "Собеседник", exact: true }),
  ).toBeVisible();
  await row.dispatchEvent("pointerup", { pointerType: "touch" });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await row.dispatchEvent("pointerdown", {
    pointerType: "touch",
    clientX: 100,
    clientY: 200,
  });
  await row.dispatchEvent("pointermove", {
    pointerType: "touch",
    clientX: 100,
    clientY: 260,
  });
  await row.dispatchEvent("pointerup", { pointerType: "touch" });
  await expect(page.locator("dialog")).toHaveCount(0);
});

test("WCAG checks on primary screens and dialog palettes", async ({ page }) => {
  await backend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of [
    "/chats/" + cid,
    "/drafts",
    "/friends",
    "/discover",
    "/profile",
    "/blocked",
    "/archive",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("button", { name: "Открыть меню профиля" }),
    ).toBeVisible();
    if (path.includes(cid))
      await expect(page.locator(".message")).toHaveCount(61);
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(
      scan.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({
          target: n.target,
          summary: n.failureSummary,
        })),
      })),
      path,
    ).toEqual([]);
  }
});

test("all dialog themes meet text contrast in light and dark modes", async ({
  page,
}) => {
  test.setTimeout(90000);
  await backend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chats/" + cid);
  await expect(page.locator(".message")).toHaveCount(61);
  for (const global of ["Светлая тема", "Тёмная тема"]) {
    await page.getByRole("button", { name: "Открыть меню профиля" }).click();
    await page.getByRole("button", { name: global, exact: true }).click();
    await page.keyboard.press("Escape");
    for (const label of [
      "Как в системе",
      "Крем",
      "Сумерки",
      "Шалфей",
      "Вишня",
      "Луна",
    ]) {
      await page.getByRole("button", { name: "Тема диалога" }).click();
      await page.getByRole("button", { name: new RegExp("^" + label) }).click();
      await page.locator(".conversation-panel").evaluate(async (el) => {
        await Promise.all(el.getAnimations().map((a) => a.finished));
      });
      const scan = await new AxeBuilder({ page })
        .withRules(["color-contrast"])
        .analyze();
      expect(
        scan.violations.map((v) =>
          v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
        ),
        global + " / " + label,
      ).toEqual([]);
    }
  }
});

test("typing the next message while sending keeps focus and text", async ({
  page,
}) => {
  await backend(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chats/" + cid);
  await expect(page.locator(".message")).toHaveCount(61);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rest/v1/messages**", async (route) => {
    if (route.request().method() === "POST") await gate;
    await route.fallback();
  });
  const input = page.getByRole("textbox", { name: "Сообщение", exact: true });
  await input.fill("Первое");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(input).toBeFocused();
  await expect(input).toBeEditable();
  await input.fill("Второе");
  release();
  await expect(page.locator(".message-body").last()).toHaveText("Первое");
  await expect(input).toHaveValue("Второе");
  await expect(input).toBeFocused();
});

test("profile loads without gallery requests, shares profile query and fits W initials", async ({
  page,
}) => {
  await backend(page);
  let reads = 0,
    galleries = 0,
    checks = 0;
  page.on("request", (r) => {
    if (r.url().includes("/auth/v1/user")) checks++;
  });
  await page.route("**/rest/v1/profiles?**", async (route) => {
    if (route.request().method() === "GET") {
      reads++;
      await route.fulfill({ json: { ...profile, username: "www" } });
    } else await route.fallback();
  });
  await page.route("**/rest/v1/profile_avatars?**", async (route) => {
    galleries++;
    await route.fulfill({ json: [] });
  });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/profile");
  await expect(
    page.getByRole("heading", { name: profile.display_name }),
  ).toBeVisible();
  expect(reads).toBe(1);
  expect(galleries).toBe(0);
  expect(checks).toBe(0);
  const glyphs = await page.locator(".avatar-initial").evaluateAll((nodes) =>
    nodes.map((n) => {
      const range = document.createRange();
      range.selectNodeContents(n);
      const g = range.getBoundingClientRect(),
        a = n.parentElement!.getBoundingClientRect();
      return (
        g.left >= a.left &&
        g.right <= a.right &&
        g.top >= a.top &&
        g.bottom <= a.bottom
      );
    }),
  );
  expect(glyphs.every(Boolean)).toBe(true);
  await page.getByRole("button", { name: "Открыть галерею аватаров" }).click();
  await expect(page.getByText("Загруженных аватаров пока нет")).toBeVisible();
  expect(galleries).toBe(1);
});

test("interest colors save and survive a reload without horizontal overflow", async ({
  page,
}) => {
  await backend(page);
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/profile");
  await page
    .getByRole("button", { name: "Редактировать", exact: true })
    .click();
  await page
    .getByLabel("Цвет интереса 1", { exact: true })
    .selectOption("purple");
  await page
    .getByRole("button", { name: "Добавить интерес", exact: true })
    .click();
  await page.getByLabel("Интерес 2", { exact: true }).fill("Природа");
  await page
    .getByLabel("Цвет интереса 2", { exact: true })
    .selectOption("green");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(
    page.locator(".tag-row span").filter({ hasText: "Дизайн" }),
  ).toHaveAttribute("data-color", "purple");
  await page.reload();
  await expect(
    page.locator(".tag-row span").filter({ hasText: "Природа" }),
  ).toHaveAttribute("data-color", "green");
  await page.screenshot({
    path: "test-results/profile-colors.png",
    fullPage: true,
  });
});

const png = (() => {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const b of body) {
      crc ^= b;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const header = Buffer.alloc(4),
      tail = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(64, 0);
  ihdr.writeUInt32BE(48, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const pixels = Buffer.alloc(48 * (1 + 64 * 3));
  for (let y = 0; y < 48; y++)
    for (let x = 0; x < 64; x++) {
      const p = y * 193 + 1 + x * 3;
      pixels[p] = 180 + x;
      pixels[p + 1] = 180 + y;
      pixels[p + 2] = 155;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
})();
test("peer avatar history stays private and a real report can be submitted", async ({
  page,
}) => {
  await backend(page);
  let report: Record<string, unknown> | undefined;
  await page.route("**/rest/v1/rpc/submit_report", async (route) => {
    report = route.request().postDataJSON();
    await route.fulfill({ json: crypto.randomUUID() });
  });
  await page.goto("/users/" + peer);
  await expect(
    page.getByRole("button", { name: "Открыть галерею аватаров" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Пожаловаться" }).click();
  await page
    .getByLabel("Причина")
    .fill("Пользователь рассылает нежелательные сообщения");
  await page.getByRole("button", { name: "Отправить жалобу" }).click();
  await expect(
    page.getByText("Жалоба отправлена на рассмотрение."),
  ).toBeVisible();
  expect(report?.reported_user).toBe(peer);
});

test("custom background validates, previews, persists for both chat members and resets", async ({
  page,
}) => {
  await backend(page);
  let stored: string | null = null;
  await page.route("**/rest/v1/conversation_appearance?**", (route) =>
    route.fulfill({ json: stored ? { background_path: stored } : null }),
  );
  await page.route("**/rest/v1/rpc/set_dialog_background", async (route) => {
    stored = route.request().postDataJSON().path;
    await route.fulfill({ json: null });
  });
  await page.route(
    "**/storage/v1/object/sign/dialog-backgrounds/**",
    (route) =>
      route.request().method() === "POST"
        ? route.fulfill({
            json: {
              signedURL: "/object/sign/dialog-backgrounds/test?token=test",
            },
          })
        : route.fulfill({ contentType: "image/png", body: png }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/chats/" + cid);
  await page.getByRole("button", { name: "Тема диалога", exact: true }).click();
  const input = page.getByLabel("Выбрать картинку");
  await input.setInputFiles({
    name: "invalid.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(
    page.getByText("Выберите JPG, PNG или WebP до 8 МБ."),
  ).toBeVisible();
  await input.setInputFiles({
    name: "wallpaper.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.locator(".wallpaper-preview")).toBeVisible();
  await page.getByRole("button", { name: "Применить фон" }).click();
  await expect(page.locator(".messages")).toHaveClass(/has-wallpaper/);
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.reload();
  await expect(page.locator(".messages")).toHaveClass(/has-wallpaper/);
  expect(
    await page.locator(".messages").evaluate((n) =>
      getComputedStyle(n)
        .backgroundSize.split(",")
        .every((v) => v.trim() === "cover"),
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/custom-background.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Тема диалога", exact: true }).click();
  await page.getByRole("button", { name: "Убрать картинку" }).click();
  await expect(page.locator(".messages")).not.toHaveClass(/has-wallpaper/);
  expect(stored).toBe(null);
});
