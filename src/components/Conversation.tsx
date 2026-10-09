import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  MoreVertical,
  Paperclip,
  Palette,
  Search,
  Send,
  Smile,
  Trash2,
  X,
  FolderOpen,
  Flag,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Avatar, initialFromUsername } from "./Avatar";
import { Modal } from "./Modal";
import { ErrorNotice } from "./ErrorNotice";
import { Attachment } from "./Attachment";
import { useAuth } from "../state/AuthContext";
import { supabase } from "../lib/supabase";
import {
  attachmentTypes,
  errorText,
  firstUnread,
  isNearBottom,
  mergeMessages,
  storageRead,
  storageWrite,
  validateAttachment,
} from "../lib/logic";
import {
  listMessages,
  listMessageWindow,
  sendMessage,
  deleteMessage,
  searchMessages,
  listMedia,
} from "../services/messages";
import { markConversationRead, setDialogTheme } from "../services/chats";
import type { ChatSummary, DialogTheme, Message } from "../types";
import { ReportModal } from "./ReportModal";

import { DialogBackground } from "./DialogBackground";
import { getBackground, backgroundUrl } from "../services/backgrounds";
const themes: [DialogTheme, string][] = [
  ["system", "Как в системе"],
  ["cream", "Крем"],
  ["twilight", "Сумерки"],
  ["sage", "Шалфей"],
  ["cherry", "Вишня"],
  ["moon", "Луна"],
];
const emoji = [
  "🙂",
  "😂",
  "❤️",
  "👍",
  "🔥",
  "🥹",
  "😎",
  "🤝",
  "👀",
  "✨",
  "🎉",
  "😅",
];
export function Conversation({
  chat,
  onActions,
}: {
  chat: ChatSummary;
  onActions: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const cid = chat.conversation_id;
  const backgroundRevision = useRef(0);
  const [backgroundPath, setBackgroundPath] = useState<string | null>(null);
  const [wallpaper, setWallpaper] = useState("");
  useEffect(() => {
    let active = true;
    const revision = backgroundRevision.current;
    getBackground(cid)
      .then((p) => {
        if (active && revision === backgroundRevision.current)
          setBackgroundPath(p);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [cid]);
  useEffect(() => {
    let active = true;
    setWallpaper("");
    const sign = () => {
      if (backgroundPath)
        backgroundUrl(backgroundPath)
          .then((url) => {
            if (active) setWallpaper(url);
          })
          .catch((e) => {
            if (active) setError(errorText(e));
          });
    };
    sign();
    const timer = setInterval(sign, 3000000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [backgroundPath]);
  const [messages, setMessages] = useState<Message[]>([]);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File>();
  const [more, setMore] = useState(false);
  const [olderBusy, setOlderBusy] = useState(false);
  const [panel, setPanel] = useState<
    "theme" | "emoji" | "search" | "media" | null
  >(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Message[]>([]);
  const [resultBusy, setResultBusy] = useState(false);
  const [resultMore, setResultMore] = useState(false);
  const [deleting, setDeleting] = useState<Message>();
  const [reporting, setReporting] = useState<Message>();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [newBelow, setNewBelow] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const editor = useRef<HTMLInputElement>(null);
  const upload = useRef<HTMLInputElement>(null);
  const near = useRef(true);
  const alive = useRef(true);
  const initialized = useRef(false);
  const pendingPosition = useRef<{
    unread?: string;
    top?: number;
    bottom?: boolean;
    prepend?: number;
  }>();
  const readStamp = useRef(chat.last_read_at ?? "");
  const readBusy = useRef(false);
  const queuedRead = useRef<Message>();
  const retry = useRef<{ id: string; text: string; file?: File }>();
  const key = `apchi-scroll:${user!.id}:${cid}`;
  const savePosition = () => {
    const node = scroller.current;
    if (node && initialized.current)
      storageWrite(
        key,
        JSON.stringify({
          top: node.scrollTop,
          oldest: messagesRef.current[0]?.created_at,
        }),
      );
  };
  function bottom() {
    const n = scroller.current;
    if (n) {
      n.scrollTop = n.scrollHeight;
      near.current = true;
      setNewBelow(false);
    }
  }
  async function flushRead() {
    if (readBusy.current || !queuedRead.current) return;
    const m = queuedRead.current;
    queuedRead.current = undefined;
    if (m.created_at <= readStamp.current) return;
    readBusy.current = true;
    try {
      await markConversationRead(cid, m.id);
      if (m.created_at > readStamp.current) readStamp.current = m.created_at;
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      readBusy.current = false;
      if (alive.current && queuedRead.current) void flushRead();
    }
  }
  function markVisible() {
    const node = scroller.current;
    if (
      !node ||
      !initialized.current ||
      document.visibilityState !== "visible" ||
      panel
    )
      return;
    const bounds = node.getBoundingClientRect();
    let newest: Message | undefined;
    const byId = new Map(messagesRef.current.map((m) => [m.id, m]));
    node.querySelectorAll<HTMLElement>("[data-message]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.top < bounds.bottom - 8 && r.bottom > bounds.top + 8) {
        const m = byId.get(el.dataset.message ?? "");
        if (
          m &&
          m.created_at > readStamp.current &&
          (!newest || m.created_at > newest.created_at)
        )
          newest = m;
      }
    });
    if (newest) {
      queuedRead.current = newest;
      void flushRead();
    }
  }
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    let refreshing = false;
    let buffered: Message[] = [];
    async function load(initial = false) {
      if (refreshing) return;
      refreshing = true;
      const existingIds = new Set(messagesRef.current.map((m) => m.id));
      try {
        let saved: { top?: number; oldest?: string } = {};
        try {
          saved = JSON.parse(storageRead(key) ?? "{}");
        } catch {}
        const target = initial
          ? chat.unread_count > 0
            ? chat.last_read_at
            : saved.oldest
          : messagesRef.current[0]?.created_at;
        let all = target
          ? await listMessageWindow(cid, target)
          : await listMessages(cid);
        let page = all;
        while (
          initial &&
          !target &&
          page.length === 100 &&
          ((initial && chat.unread_count > 0 && !target) ||
            (target && page[0].created_at > target))
        ) {
          page = await listMessages(cid, page[0]);
          if (cancelled) return;
          all = mergeMessages(page, all);
        }
        if (cancelled) return;
        if (initial) {
          const unread =
            chat.unread_count > 0
              ? firstUnread(all, user!.id, chat.last_read_at)
              : undefined;
          pendingPosition.current = unread
            ? { unread: unread.id }
            : typeof saved.top === "number"
              ? { top: saved.top }
              : { bottom: true };
          setMore(Boolean(target) || page.length === 100);
        } else if (near.current) pendingPosition.current = { bottom: true };
        else if (
          all.some((m) => !existingIds.has(m.id) && m.sender_id !== user!.id)
        )
          setNewBelow(true);
        const arrived = buffered;
        // Preserve successful sends/older pages that completed during this fetch.
        setMessages((current) =>
          mergeMessages(all, [
            ...arrived,
            ...current.filter((m) => !existingIds.has(m.id)),
          ]),
        );
        buffered = [];
        setError("");
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(errorText(e));
          setLoading(false);
        }
      } finally {
        refreshing = false;
      }
    }
    void load(true);
    const channel = supabase
      .channel("dialog:" + cid + ":" + crypto.randomUUID())
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: "conversation_id=eq." + cid,
        },
        (payload) => {
          if (cancelled || !("id" in payload.new)) return;
          const m = payload.new as Message;
          buffered.push(m);
          if (initialized.current) {
            if (near.current) pendingPosition.current = { bottom: true };
            else if (payload.eventType === "INSERT") setNewBelow(true);
            setMessages((current) => mergeMessages(current, [m]));
          }
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && initialized.current) void load();
      });
    const resync = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = setInterval(resync, 20000);
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      savePosition();
      alive.current = false;
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", resync);
      void supabase.removeChannel(channel);
    };
  }, [cid, user?.id]);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node || loading) return;
    const position = pendingPosition.current;
    if (position) {
      if (position.unread) {
        const el = node.querySelector<HTMLElement>(
          `[data-message="${position.unread}"]`,
        );
        if (el)
          node.scrollTop +=
            el.getBoundingClientRect().top -
            node.getBoundingClientRect().top -
            12;
      } else if (position.prepend !== undefined)
        node.scrollTop += node.scrollHeight - position.prepend;
      else if (position.bottom) node.scrollTop = node.scrollHeight;
      else node.scrollTop = position.top ?? 0;
      pendingPosition.current = undefined;
    }
    initialized.current = true;
    near.current = isNearBottom(
      node.scrollTop,
      node.scrollHeight,
      node.clientHeight,
    );
    savePosition();
    markVisible();
  }, [messages, loading]);
  useEffect(() => {
    if (!panel) return;
    let live = true;
    const timer = setTimeout(async () => {
      if (panel !== "search" && panel !== "media") return;
      if (panel === "search" && !query.trim()) {
        setResults([]);
        setResultMore(false);
        return;
      }
      setResultBusy(true);
      try {
        const items =
          panel === "media"
            ? await listMedia(cid)
            : await searchMessages(cid, query.trim());
        if (live) {
          setResults(items);
          setResultMore(items.length === 50);
        }
      } catch (e) {
        if (live) setError(errorText(e));
      } finally {
        if (live) setResultBusy(false);
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [panel, query, cid]);
  async function moreResults() {
    setResultBusy(true);
    try {
      const items =
        panel === "media"
          ? await listMedia(cid, results.length)
          : await searchMessages(cid, query, results.length);
      setResults((current) => [...current, ...items]);
      setResultMore(items.length === 50);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setResultBusy(false);
    }
  }
  async function older() {
    if (olderBusy) return;
    setOlderBusy(true);
    try {
      const items = await listMessages(cid, messages[0]);
      if (!alive.current) return;
      pendingPosition.current = {
        prepend: scroller.current?.scrollHeight ?? 0,
      };
      setMessages((current) => mergeMessages(items, current));
      setMore(items.length === 100);
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      if (alive.current) setOlderBusy(false);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    editor.current?.focus();
    if (sendingRef.current || chat.unavailable || (!input.trim() && !file))
      return;
    const text = input.trim();
    const selected = file;
    const attempt =
      retry.current?.text === text && retry.current.file === selected
        ? retry.current
        : { id: crypto.randomUUID(), text, file: selected };
    retry.current = attempt;
    sendingRef.current = true;
    setSending(true);
    setError("");
    // Keep the actual editable input focused; toggling readOnly can dismiss a mobile IME.
    setInput("");
    try {
      const m = await sendMessage(cid, text, selected, attempt.id);
      if (!alive.current) return;
      pendingPosition.current = { bottom: true };
      setMessages((current) => mergeMessages(current, [m]));
      setFile(undefined);
      retry.current = undefined;
      window.dispatchEvent(new Event("apchi:chats-updated"));
    } catch (e) {
      if (alive.current) {
        setInput((current) => text + (current ? " " + current : ""));
        setError(errorText(e));
      }
    } finally {
      sendingRef.current = false;
      if (alive.current) setSending(false);
    }
  }
  const online = Boolean(
    chat.last_seen_at && Date.now() - Date.parse(chat.last_seen_at) < 70000,
  );
  return (
    <section
      className="conversation-panel panel"
      data-dialog-theme={chat.dialog_theme}
    >
      <header className="conversation-header">
        <button
          className="mobile-back"
          aria-label="Назад к чатам"
          onClick={() => navigate("/chats")}
        >
          <ArrowLeft size={20} />
        </button>
        <Avatar
          initials={initialFromUsername(chat.username)}
          src={chat.avatar_url}
          color={chat.avatar_color}
        />
        <button
          className="conversation-title title-button"
          aria-label={"Открыть профиль: " + chat.display_name}
          onClick={() => navigate("/users/" + chat.other_user_id)}
        >
          <strong>{chat.display_name}</strong>
          <span className={"presence " + (online ? "online" : "offline")}>
            <i />
            {online ? "В сети" : "Не в сети"}
          </span>
        </button>
        <div className="conversation-tools">
          <button
            className="tool-button"
            aria-label="Поиск по сообщениям"
            onClick={() => setPanel("search")}
          >
            <Search size={18} />
          </button>
          <button
            className="tool-button"
            aria-label="Тема диалога"
            onClick={() => setPanel("theme")}
          >
            <Palette size={18} />
          </button>
          <button
            className="tool-button"
            aria-label="Медиа и файлы"
            onClick={() => setPanel("media")}
          >
            <FolderOpen size={18} />
          </button>
          <button
            className="tool-button"
            aria-label="Действия с чатом"
            onClick={onActions}
          >
            <MoreVertical size={18} />
          </button>
        </div>
      </header>
      <div
        className={"messages" + (wallpaper ? " has-wallpaper" : "")}
        style={
          wallpaper
            ? {
                backgroundImage: `linear-gradient(color-mix(in srgb, var(--dialog-bg, var(--surface)) 30%, transparent),color-mix(in srgb, var(--dialog-bg, var(--surface)) 30%, transparent)), url(${JSON.stringify(wallpaper)})`,
              }
            : undefined
        }
        ref={scroller}
        onScroll={() => {
          const n = scroller.current!;
          near.current = isNearBottom(
            n.scrollTop,
            n.scrollHeight,
            n.clientHeight,
          );
          if (near.current) setNewBelow(false);
          savePosition();
          markVisible();
        }}
      >
        {loading ? (
          <div className="empty-block">Загрузка сообщений…</div>
        ) : (
          <>
            {more && (
              <button
                className="load-older secondary-button"
                disabled={olderBusy}
                onClick={() => void older()}
              >
                {olderBusy ? "Загрузка…" : "Предыдущие сообщения"}
              </button>
            )}
            {!messages.length && (
              <div className="empty-block">
                <strong>Начните разговор</strong>
              </div>
            )}
            {messages.map((m) => (
              <article
                key={m.id}
                data-message={m.id}
                className={
                  "message " + (m.sender_id === user!.id ? "mine" : "theirs")
                }
              >
                <div className="message-bubble">
                  {m.deleted_at ? (
                    <span className="deleted-message">Сообщение удалено</span>
                  ) : (
                    <>
                      {m.body && <div className="message-body">{m.body}</div>}
                      {m.attachment_path && (
                        <Attachment
                          message={m}
                          onLoad={() => {
                            if (near.current) bottom();
                            markVisible();
                          }}
                        />
                      )}
                    </>
                  )}
                  <div className="message-meta">
                    <time>
                      {new Date(m.created_at).toLocaleTimeString("ru-RU", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    {m.sender_id === user!.id && !m.deleted_at && (
                      <button
                        aria-label="Удалить сообщение"
                        onClick={() => setDeleting(m)}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                    {m.sender_id !== user!.id && !m.deleted_at && (
                      <button
                        aria-label="Пожаловаться на сообщение"
                        onClick={() => setReporting(m)}
                      >
                        <Flag size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </>
        )}
      </div>
      <div className="composer-wrap">
        {newBelow && (
          <button className="new-messages secondary-button" onClick={bottom}>
            <ArrowDown size={16} />
            Новые сообщения
          </button>
        )}
        <ErrorNotice error={error} />
        {chat.unavailable ? (
          <div className="empty-block blocked-composer">
            {chat.blocked_by_me
              ? "Пользователь заблокирован. Разблокировать можно в меню чата."
              : "Отправка сообщений недоступна."}
          </div>
        ) : (
          <>
            {file && (
              <div className="selected-file">
                <span>{file.name}</span>
                <button
                  disabled={sending}
                  aria-label="Убрать файл"
                  onClick={() => setFile(undefined)}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            <form className="composer composer-complete" onSubmit={submit}>
              <input
                type="file"
                ref={upload}
                hidden
                accept={attachmentTypes.join(",")}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f)
                    try {
                      validateAttachment(f);
                      setFile(f);
                      setError("");
                    } catch (e) {
                      setError(errorText(e));
                    }
                }}
              />
              <button
                type="button"
                aria-label="Прикрепить файл"
                disabled={sending}
                onClick={() => upload.current?.click()}
              >
                <Paperclip size={19} />
              </button>
              <input
                ref={editor}
                aria-label="Сообщение"
                placeholder="Напишите сообщение…"
                value={input}
                maxLength={10000}
                enterKeyHint="send"
                onChange={(e) => setInput(e.target.value)}
              />
              <button
                type="button"
                aria-label="Эмодзи"
                disabled={sending}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => setPanel("emoji")}
              >
                <Smile size={19} />
              </button>
              <button
                className="send-button"
                aria-label={sending ? "Отправляется" : "Отправить"}
                aria-disabled={sending || (!input.trim() && !file)}
                onPointerDown={(e) => e.preventDefault()}
              >
                <Send size={19} />
              </button>
            </form>
          </>
        )}
      </div>
      {panel && (
        <Modal
          title={
            panel === "theme"
              ? "Тема диалога"
              : panel === "emoji"
                ? "Эмодзи"
                : panel === "media"
                  ? "Медиа и файлы"
                  : "Поиск сообщений"
          }
          onClose={() => setPanel(null)}
        >
          <ErrorNotice error={error} />
          {panel === "theme" ? (
            <div className="action-list">
              {themes.map(([id, label]) => (
                <button
                  key={id}
                  onClick={async () => {
                    try {
                      await setDialogTheme(cid, id);
                      setPanel(null);
                    } catch (e) {
                      setError(errorText(e));
                    }
                  }}
                >
                  <i className={"theme-dot theme-" + id} />
                  {label}
                  {chat.dialog_theme === id ? " ✓" : ""}
                </button>
              ))}
              <DialogBackground
                cid={cid}
                path={backgroundPath}
                url={wallpaper}
                onChange={(p) => {
                  backgroundRevision.current++;
                  setBackgroundPath(p);
                }}
              />
            </div>
          ) : panel === "emoji" ? (
            <div className="emoji-grid">
              {emoji.map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    setInput((v) => v + e);
                    setPanel(null);
                    editor.current?.focus();
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
          ) : (
            <>
              {panel === "search" && (
                <input
                  className="modal-search"
                  aria-label="Найти в диалоге"
                  placeholder="Найти в диалоге"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              )}
              <div className="search-results">
                {results.map((m) => (
                  <article key={m.id}>
                    <p>{m.body}</p>
                    {m.attachment_path && <Attachment message={m} />}
                    <small>
                      {new Date(m.created_at).toLocaleString("ru-RU")}
                    </small>
                  </article>
                ))}
                {resultBusy ? (
                  <p>Загрузка…</p>
                ) : (
                  !results.length && <p>Ничего не найдено</p>
                )}
                {resultMore && (
                  <button
                    className="secondary-button"
                    disabled={resultBusy}
                    onClick={() => void moreResults()}
                  >
                    Показать ещё
                  </button>
                )}
              </div>
            </>
          )}
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Удалить сообщение у всех?"
          busy={deleteBusy}
          onClose={() => setDeleting(undefined)}
        >
          <ErrorNotice error={error} />
          <p>Сообщение и вложение станут недоступны участникам диалога.</p>
          <div className="modal-actions">
            <button
              className="secondary-button"
              disabled={deleteBusy}
              onClick={() => setDeleting(undefined)}
            >
              Отмена
            </button>
            <button
              className="danger-button"
              disabled={deleteBusy}
              onClick={async () => {
                setDeleteBusy(true);
                try {
                  await deleteMessage(deleting);
                  setMessages((current) =>
                    current.map((m) =>
                      m.id === deleting.id
                        ? {
                            ...m,
                            deleted_at: new Date().toISOString(),
                            body: "",
                          }
                        : m,
                    ),
                  );
                  setDeleting(undefined);
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setDeleteBusy(false);
                }
              }}
            >
              Удалить
            </button>
          </div>
        </Modal>
      )}
      {reporting && (
        <ReportModal
          reportedUser={reporting.sender_id}
          messageId={reporting.id}
          onClose={() => setReporting(undefined)}
        />
      )}
    </section>
  );
}
