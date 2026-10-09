import { MessageCircle, Search, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Avatar, initialsFromName } from "../components/Avatar";
import { getOrCreateDirectConversation } from "../services/chats";
import { discoverPeople } from "../services/profiles";
import type { DiscoveredUser } from "../types";

export function PeoplePage() {
  const navigate = useNavigate();

  const [people, setPeople] = useState<DiscoveredUser[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    discoverPeople(10)
      .then(setPeople)
      .finally(() => setLoading(false));
  }, []);

  async function startChat(userId: string) {
    const conversationId = await getOrCreateDirectConversation(userId);
    navigate(`/chats/${conversationId}`);
  }

  const filtered = people.filter((person) => {
    const term = query.toLowerCase();
    return (
      person.display_name.toLowerCase().includes(term) ||
      person.username.toLowerCase().includes(term) ||
      person.interests.some((item) => item.toLowerCase().includes(term))
    );
  });

  return (
    <section className="content-panel panel">
      <div className="page-heading">
        <div>
          <h1>Люди</h1>
          <p>До десяти зарегистрированных пользователей Apchi.</p>
        </div>

        <label className="search-field people-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск людей"
          />
        </label>
      </div>

      <div className="people-filters">
        <button className="active">Все</button>
        <button>Коллеги</button>
        <button>Дизайнеры</button>
        <button>Разработка</button>
        <button>Маркетинг</button>
      </div>

      {loading ? (
        <div className="center-message">Загрузка…</div>
      ) : filtered.length === 0 ? (
        <div className="empty-block large">
          <strong>Пока никого не нашли</strong>
          <span>Когда появятся другие аккаунты, они будут показаны здесь.</span>
        </div>
      ) : (
        <div className="people-grid">
          {filtered.map((person) => {
            const online = Boolean(
              person.last_seen_at &&
              Date.now() - new Date(person.last_seen_at).getTime() < 70000,
            );

            return (
              <article className="person-card" key={person.id}>
                <Avatar
                  initials={initialsFromName(person.display_name)}
                  color={person.avatar_color}
                  online={online}
                  size="lg"
                />

                <div className="person-main">
                  <h2>{person.display_name}</h2>
                  <span>@{person.username}</span>

                  {person.bio && <p>{person.bio}</p>}

                  <div className="tag-row">
                    {person.interests.slice(0, 4).map((interest) => (
                      <span key={interest}>{interest}</span>
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  className="person-action"
                  onClick={() => void startChat(person.id)}
                >
                  <MessageCircle size={17} />
                  Написать
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
