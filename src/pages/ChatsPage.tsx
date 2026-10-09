import { useState } from "react";
import { Search } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { useChats } from "../state/ChatsContext";
import { ChatActions } from "../components/ChatActions";
import { ChatRow } from "../components/ChatRow";
import { Conversation } from "../components/Conversation";
import { ErrorNotice } from "../components/ErrorNotice";
import type { ChatSummary } from "../types";
export function ChatsPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { chats, loading, error, refresh, connected } = useChats();
  const [query, setQuery] = useState("");
  const [actions, setActions] = useState<ChatSummary>();
  const active = chats.find((c) => c.conversation_id === conversationId);
  const visible = chats.filter(
    (c) =>
      !c.archived &&
      [c.display_name, c.username, c.last_message ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <>
      <section className={"messenger " + (conversationId ? "chat-open" : "")}>
        <aside className="chat-list-panel panel">
          <label className="search-field">
            <Search size={18} />
            <input
              aria-label="Поиск в чатах"
              placeholder="Поиск в чатах"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <ErrorNotice error={error} retry={() => void refresh()} />
          {!connected && (
            <small className="connection-state" role="status">
              Подключение к обновлениям…
            </small>
          )}
          <div className="chat-list">
            {loading ? (
              <div className="empty-block">Загрузка…</div>
            ) : visible.length ? (
              visible.map((chat) => (
                <ChatRow
                  key={chat.conversation_id}
                  chat={chat}
                  active={chat.conversation_id === conversationId}
                  onOpen={() =>
                    navigate("/chats/" + chat.conversation_id, {
                      state: { fromChats: true },
                    })
                  }
                  onActions={() => setActions(chat)}
                />
              ))
            ) : (
              <div className="empty-block">
                <strong>
                  {query ? "Ничего не найдено" : "Чатов пока нет"}
                </strong>
                <button
                  className="secondary-button"
                  onClick={() => navigate("/friends")}
                >
                  Открыть друзей
                </button>
              </div>
            )}
          </div>
        </aside>
        {active ? (
          <Conversation
            key={active.conversation_id}
            chat={active}
            onActions={() => setActions(active)}
          />
        ) : (
          <section className="conversation-panel panel is-empty">
            <div className="empty-conversation">
              <strong>
                {loading
                  ? "Загрузка…"
                  : conversationId
                    ? "Диалог недоступен"
                    : "Выберите диалог"}
              </strong>
              {conversationId && (
                <button
                  className="secondary-button"
                  onClick={() => navigate("/chats")}
                >
                  К списку чатов
                </button>
              )}
            </div>
          </section>
        )}
      </section>
      {actions && (
        <ChatActions
          chat={actions}
          onClose={() => setActions(undefined)}
          onDeleted={() => {
            if (conversationId === actions.conversation_id) navigate("/chats");
            void refresh();
          }}
        />
      )}
    </>
  );
}
