import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useChats } from "../state/ChatsContext";
import { ChatRow } from "../components/ChatRow";
import { ChatActions } from "../components/ChatActions";
import { ErrorNotice } from "../components/ErrorNotice";
import type { ChatSummary } from "../types";
export function ArchivePage() {
  const { chats, loading, error, refresh } = useChats();
  const navigate = useNavigate();
  const [actions, setActions] = useState<ChatSummary>();
  return (
    <section className="content-panel">
      <div className="page-heading">
        <div>
          <h1>Архив</h1>
          <p>Разговоры, убранные из основного списка.</p>
        </div>
      </div>
      <ErrorNotice error={error} retry={() => void refresh()} />
      {loading ? (
        <div className="empty-block">Загрузка…</div>
      ) : chats.some((c) => c.archived) ? (
        <div className="archive-list">
          {chats
            .filter((c) => c.archived)
            .map((c) => (
              <ChatRow
                key={c.conversation_id}
                chat={c}
                onOpen={() => navigate("/chats/" + c.conversation_id)}
                onActions={() => setActions(c)}
              />
            ))}
        </div>
      ) : (
        <div className="empty-block large">
          <strong>Архив пуст</strong>
        </div>
      )}
      {actions && (
        <ChatActions
          chat={actions}
          onClose={() => setActions(undefined)}
          onDeleted={() => void refresh()}
        />
      )}
    </section>
  );
}
