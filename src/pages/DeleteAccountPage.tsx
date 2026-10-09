import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Brand } from "../components/Brand";
import { ErrorNotice } from "../components/ErrorNotice";
import { useAuth } from "../state/AuthContext";
import { deleteAccount } from "../services/account";
import { errorText } from "../lib/logic";

export function DeleteAccountPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [first, setFirst] = useState(false),
    [phrase, setPhrase] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="legal-shell">
      <Brand />
      <article className="content-panel legal-page">
        <h1>Удаление аккаунта</h1>
        <p>
          Удаление необратимо: будут удалены профиль, черновики, настройки,
          участие в чатах и ваши файлы. Прямые диалоги с вашим участием и
          отправленные в них сообщения также будут удалены у собеседников.
        </p>
        {loading ? (
          <p>Проверяем сессию…</p>
        ) : !session ? (
          <>
            <p>
              Войдите в Apchi, затем вернитесь на эту страницу. Удаление
              доступно только владельцу активной сессии.
            </p>
            <Link className="primary-button" to="/">
              Перейти ко входу
            </Link>
          </>
        ) : !first ? (
          <button className="danger-button" onClick={() => setFirst(true)}>
            Начать удаление
          </button>
        ) : (
          <form
            className="report-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (phrase !== "УДАЛИТЬ") return;
              setBusy(true);
              setError("");
              try {
                await deleteAccount();
                navigate("/", { replace: true });
              } catch (c) {
                setError(errorText(c));
                setBusy(false);
              }
            }}
          >
            <ErrorNotice error={error} />
            <label>
              Для подтверждения введите УДАЛИТЬ
              <input
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setFirst(false);
                  setPhrase("");
                }}
              >
                Отмена
              </button>
              <button
                className="danger-button"
                disabled={busy || phrase !== "УДАЛИТЬ"}
              >
                {busy ? "Удаляем…" : "Удалить аккаунт навсегда"}
              </button>
            </div>
          </form>
        )}
        <nav aria-label="Документы">
          <Link to="/privacy">Конфиденциальность</Link>
          <Link to="/terms">Условия</Link>
          <Link to="/safety">Безопасность</Link>
        </nav>
      </article>
    </main>
  );
}
