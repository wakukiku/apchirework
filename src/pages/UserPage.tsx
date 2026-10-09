import { InterestTags } from "../components/InterestTags";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getProfileById } from "../services/profiles";
import { getOrCreateDirectConversation, blockUser } from "../services/chats";
import { Avatar, initialFromUsername } from "../components/Avatar";
import { ErrorNotice } from "../components/ErrorNotice";
import { Modal } from "../components/Modal";
import { errorText } from "../lib/logic";
import { ReportModal } from "../components/ReportModal";
export function UserPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] =
    useState<Awaited<ReturnType<typeof getProfileById>>>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let live = true;
    setProfile(undefined);
    setError("");
    getProfileById(userId!)
      .then((p) => {
        if (live) setProfile(p);
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [userId]);
  async function toggle() {
    setBusy(true);
    try {
      await blockUser(userId!, !profile!.blocked_by_me);
      setProfile(await getProfileById(userId!));
      setConfirm(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="content-panel profile-page">
      <ErrorNotice error={error} />
      {profile ? (
        <>
          <div className="profile-hero">
            <div>
              <Avatar
                size="lg"
                initials={initialFromUsername(profile.username)}
                src={profile.avatar_url}
                color={profile.avatar_color}
              />
            </div>
            <div>
              <h1>{profile.display_name}</h1>
              <span>@{profile.username}</span>
              <p
                className={
                  "presence " +
                  (profile.last_seen_at &&
                  Date.now() - Date.parse(profile.last_seen_at) < 70000
                    ? "online"
                    : "offline")
                }
              >
                <i />
                {profile.last_seen_at &&
                Date.now() - Date.parse(profile.last_seen_at) < 70000
                  ? "В сети"
                  : "Не в сети"}
              </p>
            </div>
          </div>
          <div className="profile-sections">
            {!profile.unavailable && (
              <>
                <section>
                  <h2>О себе</h2>
                  <p>{profile.bio || "Не указано"}</p>
                </section>
                <section>
                  <h2>Статус и город</h2>
                  <p>{profile.status_text}</p>
                  <p>{profile.city}</p>
                </section>
                <section>
                  <h2>Интересы</h2>
                  <InterestTags
                    interests={profile.interests}
                    colors={profile.interest_colors}
                  />
                </section>
              </>
            )}
          </div>
          <div className="profile-actions">
            {!profile.unavailable && (
              <button
                className="primary-button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    navigate(
                      "/chats/" +
                        (await getOrCreateDirectConversation(userId!)),
                    );
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Написать
              </button>
            )}
            <button
              className="danger-button"
              disabled={busy}
              onClick={() =>
                profile.blocked_by_me ? void toggle() : setConfirm(true)
              }
            >
              {profile.blocked_by_me ? "Разблокировать" : "Заблокировать"}
            </button>
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setReport(true)}
            >
              Пожаловаться
            </button>
          </div>
          {report && (
            <ReportModal
              reportedUser={userId!}
              onClose={() => setReport(false)}
            />
          )}
          {confirm && (
            <Modal
              title="Заблокировать пользователя?"
              onClose={() => setConfirm(false)}
              busy={busy}
            >
              <ErrorNotice error={error} />
              <p>Отправка сообщений между вами будет запрещена.</p>
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => void toggle()}
              >
                Заблокировать
              </button>
            </Modal>
          )}
        </>
      ) : (
        !error && <p>Загрузка профиля…</p>
      )}
    </section>
  );
}
