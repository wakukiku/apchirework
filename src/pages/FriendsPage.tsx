import { InterestTags } from "../components/InterestTags";
import { MessageCircle, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Avatar, initialFromUsername } from "../components/Avatar";
import { listFriends } from "../services/profiles";
import type { Friend } from "../types";
import { getOrCreateDirectConversation } from "../services/chats";
import { ErrorNotice } from "../components/ErrorNotice";
import { errorText } from "../lib/logic";

type Filter = "all" | "online" | "recent";

export function FriendsPage() {
  const navigate = useNavigate();

  const [friends, setFriends] = useState<Friend[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const refresh = () => {
      listFriends()
        .then((items) => {
          if (live) {
            setFriends(items);
            setError("");
          }
        })
        .catch((e) => {
          if (live) setError(errorText(e));
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();

    return friends.filter((person) => {
      const online = Boolean(
        person.last_seen_at &&
        Date.now() - new Date(person.last_seen_at).getTime() < 70000,
      );

      if (filter === "online" && !online) return false;
      if (
        filter === "recent" &&
        (!person.last_message_at ||
          Date.now() - Date.parse(person.last_message_at) > 7 * 86400000)
      )
        return false;

      if (!term) return true;

      return (
        person.display_name.toLowerCase().includes(term) ||
        person.username.toLowerCase().includes(term) ||
        person.bio.toLowerCase().includes(term) ||
        person.interests.some((interest) =>
          interest.toLowerCase().includes(term),
        )
      );
    });
  }, [friends, filter, query]);

  return (
    <section className="content-panel friends-panel">
      <ErrorNotice error={error} />
      <div className="page-heading">
        <div>
          <h1>Друзья</h1>
          <p>Люди, с которыми вы уже общались в Apchi.</p>
        </div>

        <label className="search-field people-search">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск среди друзей"
            aria-label="Поиск среди друзей"
          />
        </label>
      </div>

      <div className="system-filters no-scrollbar">
        <button
          type="button"
          className={filter === "all" ? "active" : ""}
          onClick={() => setFilter("all")}
        >
          Все
        </button>
        <button
          type="button"
          className={filter === "online" ? "active" : ""}
          onClick={() => setFilter("online")}
        >
          Онлайн
        </button>
        <button
          type="button"
          className={filter === "recent" ? "active" : ""}
          onClick={() => setFilter("recent")}
        >
          Недавние
        </button>
      </div>

      {loading ? (
        <div className="center-message inline-loading">Загрузка…</div>
      ) : visible.length === 0 ? (
        <div className="empty-block large">
          <strong>Здесь пока тихо</strong>
          <span>
            После первого настоящего разговора пользователь появится в друзьях.
          </span>
        </div>
      ) : (
        <div className="people-grid">
          {visible.map((person) => {
            const online = Boolean(
              person.last_seen_at &&
              Date.now() - new Date(person.last_seen_at).getTime() < 70000,
            );

            return (
              <article className="person-card" key={person.user_id}>
                <Avatar
                  initials={initialFromUsername(person.username)}
                  src={person.avatar_url}
                  color={person.avatar_color}
                  online={online}
                  size="lg"
                />

                <div className="person-main">
                  <h2>
                    <button
                      className="title-button"
                      onClick={() => navigate("/users/" + person.user_id)}
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
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const cid = await getOrCreateDirectConversation(
                        person.user_id,
                      );
                      window.dispatchEvent(new Event("apchi:chats-updated"));
                      navigate(`/chats/${cid}`);
                    } catch (e) {
                      setError(errorText(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <MessageCircle size={17} />
                  Написать
                </button>
              </article>
            );
          })}
        </div>
      )}

      <div className="discover-friends-row">
        <button
          type="button"
          className="discover-friends-button"
          onClick={() => navigate("/discover")}
        >
          <Sparkles size={18} />
          Возможные друзья
        </button>
      </div>
    </section>
  );
}
