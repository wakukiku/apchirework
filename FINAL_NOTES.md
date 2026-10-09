# Apchi — release notes

## Реализовано

- Готовый web-мессенджер и mobile responsive без mock-данных в production.
- Auth, email confirmation/resend, профиль, приватная история аватаров, цветные интересы и presence.
- Direct-чаты, Realtime, unread, scroll restore/first unread, pin, archive, mute, delete-for-self, block/unblock и long-press.
- Вложения в private Storage, медиа/файлы, поиск, emoji, темы диалога и личный фон.
- Друзья только после реальной переписки, discovery до 10 пользователей, личные drafts.
- Browser notifications и звук с учётом mute/block/открытого диалога.
- Реальные жалобы на профиль и сообщение; server-side rate limits.
- `/privacy`, `/terms`, `/safety`, `/delete-account` и двойное подтверждение удаления.
- PWA: manifest, install UX, offline app shell, auto-update, apple/maskable icons из канонического `Brand.tsx`.
- Supabase-запросы и приватные данные не кэшируются service worker.

## Миграции

- База Stage 1/1.1: выполнить `003`, затем `004`, затем `005_public_release.sql`.
- Если `003` и `004` уже применены: выполнить только `005_public_release.sql`.
- Новая пустая база: выполнить только итоговый `supabase/schema.sql`.

Дополнительно развернуть Edge Function `delete-account` командой из README.

## Настроить вручную

- `.env.local`: Supabase URL + publishable key; Turnstile site key только при CAPTCHA.
- Supabase Auth: production Site URL, localhost/production Redirect URLs, email confirmation, custom SMTP и email templates.
- При CAPTCHA: Turnstile secret в Supabase Dashboard, public site key во frontend env.
- Vercel: те же публичные env variables, build `npm run build`, output `dist`.
- Не добавлять service role во frontend и не делать Storage buckets публичными.

## Запуск, deploy и PWA

```sh
npm install
npm run typecheck
npm test
npm run build
```

После Vercel deploy проверьте прямое открытие routes, затем PWA в DevTools → Application.

Android: меню аватара → «Установить Apchi». iPhone: эта кнопка показывает шаги Safari «Поделиться» → «На экран Домой» → «Добавить».

## Live validation после подключения production credentials

1. Зарегистрировать два новых аккаунта и подтвердить email.
2. Проверить discovery, создание чата, обмен сообщениями в двух браузерах, unread/reload/scroll.
3. Проверить pin/archive/mute/delete/block/unblock и уведомления при скрытой вкладке.
4. Загрузить/выбрать/удалить аватар; убедиться, что чужая история недоступна.
5. Проверить drafts, вложения, поиск, emoji, темы и фон диалога.
6. Отправить жалобу и проверить запись `reports` через Dashboard.
7. Удалить отдельный тестовый аккаунт через `/delete-account` и проверить Auth, таблицы и Storage.
8. Установить PWA на Android/iPhone и проверить standalone.

Без `.env.local` нельзя честно проверить реальную доставку email, двухаккаунтный Realtime, Storage, системные уведомления, Edge Function и настройки production Supabase. Учётные данные и секреты в проект/ZIP не записывались.
