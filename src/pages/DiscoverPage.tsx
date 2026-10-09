import { InterestTags } from "../components/InterestTags";
import { ArrowLeft, MessageCircle, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Avatar, initialFromUsername } from "../components/Avatar";
import { getOrCreateDirectConversation } from "../services/chats";
import { discoverPeople } from "../services/profiles";
import type { DiscoveredUser } from "../types";
import { ErrorNotice } from "../components/ErrorNotice";
import { errorText } from "../lib/logic";

export function DiscoverPage() {
  const navigate = useNavigate();
  const [people, setPeople] = useState<DiscoveredUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      setPeople(await discoverPeople(10));
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

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return people;

    return people.filter(
      (person) =>
        person.display_name.toLowerCase().includes(term) ||
        person.username.toLowerCase().includes(term) ||
        person.bio.toLowerCase().includes(term) ||
        person.interests.some((tag) => tag.toLowerCase().includes(term)),
    );
  }, [people, query]);

  async function startChat(userId: string) {
    setBusy(true);
    try {
      const conversationId = await getOrCreateDirectConversation(userId);
      window.dispatchEvent(new Event("apchi:chats-updated"));
      navigate(`/chats/${conversationId}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content-panel discover-panel">
      <ErrorNotice error={error} />
      <div className="page-heading discover-heading">
        <button
          type="button"
          className="round-button"
          onClick={() => navigate("/friends")}
          aria-label="Назад"
        >
          <ArrowLeft size={19} />
        </button>

        <div>
          <h1>Возможные друзья</h1>
          <p>
            До десяти случайных пользователей, с которыми вы ещё не общались.
          </p>
        </div>

        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={() => void refresh()}
        >
          <RefreshCw size={17} />
          Обновить
        </button>
      </div>

      <label className="search-field discover-search">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Имя, ник или интерес"
          aria-label="Поиск по имени, нику или интересам"
        />
      </label>

      {loading ? (
        <div className="center-message inline-loading">Загрузка…</div>
      ) : visible.length === 0 ? (
        <div className="empty-block large">
          <strong>Новых людей пока нет</strong>
          <span>Попробуйте обновить список позже.</span>
        </div>
      ) : (
        <div className="people-grid discover-grid">
          {visible.map((person) => (
            <article className="person-card" key={person.id}>
              <Avatar
                initials={initialFromUsername(person.username)}
                src={person.avatar_url}
                color={person.avatar_color}
                size="lg"
              />

              <div className="person-main">
                <h2>
                  <button
                    className="title-button"
                    onClick={() => navigate("/users/" + person.id)}
                  >
                    {person.display_name}
                  </button>
                </h2>
                <span>@{person.username}</span>
                {person.bio && <p>{person.bio}</p>}

                {person.interests.length > 0 && (
                  <InterestTags
                    interests={person.interests.slice(0, 4)}
                    colors={person.interest_colors}
                  />
                )}
              </div>

              <button
                type="button"
                className="person-action"
                disabled={busy}
                onClick={() => void startChat(person.id)}
              >
                <MessageCircle size={17} />
                Написать
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
