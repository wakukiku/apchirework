import { Check, CheckCheck, MoreHorizontal, Reply } from "lucide-react";
import {
  useRef,
  useState,
  useEffect,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Message } from "../types";
import { Attachment } from "./Attachment";

export function MessageItem({
  message,
  currentUserId,
  otherDisplayName,
  read,
  highlighted,
  onReply,
  onActions,
  onJumpToReply,
  onAttachmentLoad,
}: {
  message: Message;
  currentUserId: string;
  otherDisplayName: string;
  read: boolean;
  highlighted: boolean;
  onReply: () => void;
  onActions: () => void;
  onJumpToReply: () => void;
  onAttachmentLoad: () => void;
}) {
  const own = message.sender_id === currentUserId;
  const start = useRef<{ x: number; y: number; pointerId: number }>();
  const longPress = useRef<number>();
  const longPressed = useRef(false);
  const swipeDistance = useRef(0);
  const [swipe, setSwipe] = useState(0);

  function clearLongPress() {
    if (longPress.current !== undefined) {
      window.clearTimeout(longPress.current);
      longPress.current = undefined;
    }
  }
  useEffect(() => clearLongPress, []);
  function pointerDown(e: ReactPointerEvent<HTMLElement>) {
    if (
      e.button !== 0 ||
      e.pointerType === "mouse" ||
      !window.matchMedia("(max-width: 820px)").matches
    )
      return;
    start.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
    longPressed.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* Synthetic events may not own a native pointer; real touch events do. */
    }
    longPress.current = window.setTimeout(() => {
      longPressed.current = true;
      setSwipe(0);
      onActions();
    }, 520);
  }
  function pointerMove(e: ReactPointerEvent<HTMLElement>) {
    const origin = start.current;
    if (!origin || origin.pointerId !== e.pointerId) return;
    const dx = e.clientX - origin.x;
    const dy = e.clientY - origin.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearLongPress();
    if (dx < 0 && Math.abs(dx) > Math.abs(dy)) {
      swipeDistance.current = Math.max(-76, dx);
      setSwipe(swipeDistance.current);
    }
  }
  function pointerEnd(e: ReactPointerEvent<HTMLElement>) {
    const origin = start.current;
    clearLongPress();
    start.current = undefined;
    if (
      origin?.pointerId === e.pointerId &&
      !longPressed.current &&
      swipeDistance.current <= -52
    ) {
      longPressed.current = true;
      onReply();
    }
    swipeDistance.current = 0;
    setSwipe(0);
  }
  function pointerCancel() {
    clearLongPress();
    start.current = undefined;
    swipeDistance.current = 0;
    setSwipe(0);
  }

  const reply = message.reply_to;
  const replyText = reply
    ? reply.deleted_at
      ? "Исходное сообщение недоступно"
      : reply.body || reply.attachment_name || "Вложение"
    : "Исходное сообщение недоступно";
  const replyAuthor = reply
    ? reply.sender_id === currentUserId
      ? "Вы"
      : otherDisplayName
    : "Сообщение";

  return (
    <article
      data-message={message.id}
      className={`message ${own ? "mine" : "theirs"}${highlighted ? " message-highlighted" : ""}`}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerEnd}
      onPointerCancel={pointerCancel}
      onClickCapture={(e) => {
        if (!longPressed.current) return;
        e.preventDefault();
        e.stopPropagation();
        longPressed.current = false;
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onActions();
      }}
    >
      <div className="message-swipe-reply" aria-hidden="true">
        <Reply size={17} />
      </div>
      <div
        className="message-bubble"
        style={{ transform: `translateX(${swipe}px)` }}
      >
        {message.reply_to_message_id && (
          <button className="message-reply-quote" onClick={onJumpToReply}>
            <strong>{replyAuthor}</strong>
            <span>{replyText}</span>
          </button>
        )}
        {message.body && <div className="message-body">{message.body}</div>}
        {message.attachment_path && (
          <Attachment message={message} onLoad={onAttachmentLoad} />
        )}
        <div className="message-meta">
          <time>
            {new Date(message.created_at).toLocaleTimeString("ru-RU", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
          {own && (
            <span
              className="message-receipt"
              role="img"
              aria-label={read ? "Прочитано" : "Отправлено"}
              title={read ? "Прочитано" : "Отправлено"}
            >
              {read ? <CheckCheck size={14} /> : <Check size={14} />}
            </span>
          )}
          <button aria-label="Действия с сообщением" onClick={onActions}>
            <MoreHorizontal size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}
