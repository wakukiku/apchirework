import { useState } from "react";
import { Modal } from "./Modal";
import { ErrorNotice } from "./ErrorNotice";
import { submitReport } from "../services/reports";
import { errorText } from "../lib/logic";

export function ReportModal({
  reportedUser,
  messageId,
  onClose,
}: {
  reportedUser: string;
  messageId?: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <Modal
      title={
        messageId ? "Пожаловаться на сообщение" : "Пожаловаться на пользователя"
      }
      onClose={onClose}
      busy={busy}
    >
      {sent ? (
        <>
          <p>Жалоба отправлена на рассмотрение.</p>
          <button className="primary-button" onClick={onClose}>
            Готово
          </button>
        </>
      ) : (
        <form
          className="report-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await submitReport(reportedUser, reason, messageId);
              setSent(true);
            } catch (c) {
              setError(errorText(c));
            } finally {
              setBusy(false);
            }
          }}
        >
          <ErrorNotice error={error} />
          <label>
            Причина
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={10}
              maxLength={500}
              rows={5}
              required
              placeholder="Коротко опишите нарушение"
            />
          </label>
          <small>
            Не отправляйте в жалобе пароли и другие секретные данные.
          </small>
          <button className="danger-button" disabled={busy}>
            {busy ? "Отправляем…" : "Отправить жалобу"}
          </button>
        </form>
      )}
    </Modal>
  );
}
