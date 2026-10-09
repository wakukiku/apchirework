import { useEffect, useRef } from "react";
import { MoreVertical, Pin, BellOff } from "lucide-react";
import { Avatar, initialFromUsername } from "./Avatar";
import type { ChatSummary } from "../types";
export function ChatRow({
  chat,
  active,
  onOpen,
  onActions,
}: {
  chat: ChatSummary;
  active?: boolean;
  onOpen: () => void;
  onActions: () => void;
}) {
  const timer = useRef<number>();
  const origin = useRef({ x: 0, y: 0 });
  const held = useRef(false);
  const cancel = () => clearTimeout(timer.current);
  useEffect(() => cancel, []);
  return (
    <div className={"chat-row-wrap" + (active ? " active" : "")}>
      <button
        className="chat-row"
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return;
          held.current = false;
          origin.current = { x: e.clientX, y: e.clientY };
          timer.current = window.setTimeout(() => {
            held.current = true;
            onActions();
          }, 500);
        }}
        onPointerMove={(e) => {
          if (
            Math.hypot(
              e.clientX - origin.current.x,
              e.clientY - origin.current.y,
            ) > 10
          )
            cancel();
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => {
          e.preventDefault();
          cancel();
          held.current = true;
          onActions();
        }}
        onClick={() => {
          if (held.current) {
            held.current = false;
            return;
          }
          onOpen();
        }}
      >
        <Avatar
          initials={initialFromUsername(chat.username)}
          src={chat.avatar_url}
          color={chat.avatar_color}
          online={Boolean(
            chat.last_seen_at &&
            Date.now() - Date.parse(chat.last_seen_at) < 70000,
          )}
        />
        <span className="chat-row-copy">
          <span className="chat-row-head">
            <strong>{chat.display_name}</strong>
            <time>
              {chat.last_message_at
                ? new Date(chat.last_message_at).toLocaleTimeString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : ""}
            </time>
          </span>
          <span className="chat-row-preview">
            <span>{chat.last_message ?? "Новый диалог"}</span>
            {chat.pinned && <Pin size={13} />}{" "}
            {chat.muted && <BellOff size={13} />}{" "}
            {chat.unread_count > 0 && (
              <b className="unread">{chat.unread_count}</b>
            )}
          </span>
        </span>
      </button>
      <button
        className="row-menu"
        aria-label={"Действия: " + chat.display_name}
        onClick={onActions}
      >
        <MoreVertical size={17} />
      </button>
    </div>
  );
}
