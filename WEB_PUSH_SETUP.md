# Apchi Web Push — безопасное включение

Текущий production не нужно выключать. Включайте Web Push поэтапно: база и Edge Function сначала, frontend env — последним.

## 1. Сгенерировать VAPID keys

```bash
npm run vapid:generate
```

Команда выведет:

```text
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=https://apchi.fun
```

Private key не добавлять в GitHub, `.env.local` или Vercel frontend env.

## 2. Применить migration 006

В существующем Supabase-проекте выполнить только:

```text
supabase/migrations/006_web_push.sql
```

`schema.sql` на существующей базе не запускать.

## 3. Добавить Edge Function secrets

Supabase Dashboard → Edge Functions → Secrets:

```text
VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=https://apchi.fun
```

`SUPABASE_URL` и серверные ключи Supabase Edge Functions получает от платформы автоматически.

## 4. Развернуть `send-push`

Через Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase functions deploy send-push
```

Функция настроена с `verify_jwt = true` и дополнительно проверяет пользователя внутри самой функции.

## 5. Только теперь добавить public key в Vercel

Vercel → Apchi → Settings → Environment Variables:

```text
VITE_VAPID_PUBLIC_KEY=<public key>
```

Добавить минимум для Production и сделать новый deployment.

## 6. Проверка на телефоне

1. Открыть/переустановить PWA Apchi после нового deployment.
2. В меню профиля включить уведомления. Если они были включены до Web Push, при необходимости выключить и включить их один раз.
3. Полностью закрыть PWA.
4. Со второго аккаунта отправить сообщение.
5. Уведомление должно появиться в системной шторке/Notification Center.
6. Нажатие по уведомлению должно открыть нужный чат.
7. Проверить mute: push не приходит.
8. Проверить block: push не приходит.
9. Выйти из аккаунта, закрыть PWA и отправить сообщение: push старому аккаунту на этом устройстве приходить не должен.

## Поведение

- Если открыт именно тот чат и окно видно, системный push подавляется.
- Если открыт другой чат, вкладка/PWA в фоне или приложение полностью закрыто, push показывается системой.
- Существующий короткий звук Apchi остаётся для живого приложения через Realtime.
- Звук системного Web Push контролирует ОС/браузер; Web Notification API не задаёт собственный аудиофайл уведомления.
- `mute` и `block` проверяются на сервере перед отправкой.
- Истёкшие push subscriptions удаляются после ответов push-сервиса 404/410.
- Один аккаунт может иметь несколько устройств/браузеров.

## Откат

Если Web Push нужно временно выключить, достаточно удалить `VITE_VAPID_PUBLIC_KEY` из Vercel и redeploy. Текстовые сообщения, Realtime и старая foreground-логика уведомлений продолжат работать. Migration 006 при этом можно оставить в базе.
