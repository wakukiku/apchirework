import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { blockUser, listBlocked } from "../services/chats";
import { ErrorNotice } from "../components/ErrorNotice";
import { errorText } from "../lib/logic";
export function BlockedPage() {
  const [items, setItems] = useState<Awaited<ReturnType<typeof listBlocked>>>(
    [],
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  async function refresh() {
    setLoading(true);
    try {
      setItems(await listBlocked());
      setError("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <section className="content-panel">
      <div className="page-heading">
        <div>
          <h1>Заблокированные пользователи</h1>
          <Link to="/profile">Мой профиль</Link>
        </div>
      </div>
      <ErrorNotice error={error} retry={() => void refresh()} />
      {loading ? (
        <p>Загрузка…</p>
      ) : items.length ? (
        <div className="blocked-list">
          {items.map((p) => (
            <article key={p.id}>
              <Link to={"/users/" + p.id}>
                {p.display_name} <small>@{p.username}</small>
              </Link>
              <button
                className="secondary-button"
                disabled={!!busy}
                onClick={async () => {
                  setBusy(p.id);
                  try {
                    await blockUser(p.id, false);
                    setItems((v) => v.filter((x) => x.id !== p.id));
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy("");
                  }
                }}
              >
                Разблокировать
              </button>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-block large">Список пуст</div>
      )}
    </section>
  );
}
