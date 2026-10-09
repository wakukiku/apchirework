import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal } from "./Modal";
import { ErrorNotice } from "./ErrorNotice";
import { blockUser, setChatSetting } from "../services/chats";
import { errorText } from "../lib/logic";
import type { ChatSummary } from "../types";
import { ReportModal } from "./ReportModal";
export function ChatActions({
  chat,
  onClose,
  onDeleted,
}: {
  chat: ChatSummary;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState<
    "menu" | "delete" | "block" | "after-delete" | "report"
  >("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(fn: () => Promise<void>, next?: () => void) {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (next) next();
      else onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return step === "report" ? (
    <ReportModal reportedUser={chat.other_user_id} onClose={onClose} />
  ) : (
    <Modal
      title={
        step === "delete"
          ? "Удалить чат?"
          : step === "block" || step === "after-delete"
            ? "Заблокировать пользователя?"
            : chat.display_name
      }
      onClose={onClose}
      busy={busy}
    >
      <ErrorNotice error={error} />
      {step === "menu" ? (
        <div className="action-list">
          <button
            disabled={busy}
            onClick={() =>
              void run(() =>
                setChatSetting(chat.conversation_id, "pin", !chat.pinned),
              )
            }
          >
            {chat.pinned ? "Открепить" : "Закрепить"}
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(() =>
                setChatSetting(chat.conversation_id, "archive", !chat.archived),
              )
            }
          >
            {chat.archived ? "Вернуть из архива" : "Архивировать"}
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void run(() =>
                setChatSetting(chat.conversation_id, "mute", !chat.muted),
              )
            }
          >
            {chat.muted ? "Включить уведомления" : "Отключить уведомления"}
          </button>
          <button
            onClick={() => {
              onClose();
              navigate("/users/" + chat.other_user_id);
            }}
          >
            Открыть профиль
          </button>
          <button className="danger" onClick={() => setStep("report")}>
            Пожаловаться
          </button>
          <button className="danger" onClick={() => setStep("delete")}>
            Удалить чат для себя
          </button>
          <button
            disabled={busy}
            className="danger"
            onClick={() =>
              chat.blocked_by_me
                ? void run(() => blockUser(chat.other_user_id, false))
                : setStep("block")
            }
          >
            {chat.blocked_by_me
              ? "Разблокировать"
              : "Заблокировать пользователя"}
          </button>
        </div>
      ) : (
        <>
          <p>
            {step === "delete"
              ? "Прежняя история исчезнет только у вас. У собеседника она останется."
              : step === "after-delete"
                ? "Чат удалён. Запретить новые сообщения от этого пользователя?"
                : "Вы не сможете отправлять друг другу сообщения до разблокировки."}
          </p>
          <div className="modal-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={onClose}
            >
              {step === "after-delete" ? "Нет" : "Отмена"}
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    step === "delete"
                      ? setChatSetting(chat.conversation_id, "delete")
                      : blockUser(chat.other_user_id, true),
                  step === "delete"
                    ? () => {
                        onDeleted();
                        setStep("after-delete");
                      }
                    : undefined,
                )
              }
            >
              {busy
                ? "Подождите…"
                : step === "delete"
                  ? "Удалить"
                  : "Заблокировать"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
