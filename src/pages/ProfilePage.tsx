import { InterestTags, tagColors } from "../components/InterestTags";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  Avatar,
  PrivateAvatarImage,
  initialFromUsername,
} from "../components/Avatar";
import { Modal } from "../components/Modal";
import { ErrorNotice } from "../components/ErrorNotice";
import {
  chooseAvatar,
  deleteAvatar,
  getMyProfile,
  listMyAvatars,
  updateMyProfile,
  uploadAvatar,
} from "../services/profiles";
import { errorText } from "../lib/logic";
import type { Profile, ProfileAvatar } from "../types";
export function ProfilePage() {
  const [profile, setProfile] = useState<Profile>();
  const [tags, setTags] = useState<{ name: string; color: string }[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [avatars, setAvatars] = useState<ProfileAvatar[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [deleting, setDeleting] = useState<ProfileAvatar>();
  const upload = useRef<HTMLInputElement>(null);
  async function refresh() {
    try {
      const p = await getMyProfile();
      setProfile(p);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function loadGallery() {
    setGalleryLoading(true);
    try {
      setAvatars(await listMyAvatars());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setGalleryLoading(false);
    }
  }
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
      if (gallery) await loadGallery();
      window.dispatchEvent(new Event("apchi:profile-updated"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    await action(async () => {
      await updateMyProfile({
        display_name: String(data.get("display_name")).trim(),
        username: String(data.get("username")).trim().toLowerCase(),
        bio: String(data.get("bio")).trim(),
        city: String(data.get("city")).trim() || null,
        status_text: String(data.get("status_text")).trim(),
        interests: [...new Set(tags.map((t) => t.name.trim()).filter(Boolean))],
        interest_colors: Object.fromEntries(
          tags
            .filter((t) => t.name.trim())
            .map((t) => [t.name.trim(), t.color]),
        ),
      });
      setEditing(false);
    });
  }
  return (
    <section className="profile-page content-panel">
      <ErrorNotice error={error} retry={() => void refresh()} />
      {loading ? (
        <div className="profile-state">Загрузка профиля…</div>
      ) : (
        profile && (
          <>
            <div className="profile-hero">
              <button
                className="profile-avatar-button"
                onClick={() => {
                  setGallery(true);
                  void loadGallery();
                }}
                aria-label="Открыть галерею аватаров"
              >
                <Avatar
                  initials={initialFromUsername(profile.username)}
                  src={profile.avatar_url}
                  color={profile.avatar_color}
                  size="lg"
                />
                <span>Аватарки</span>
              </button>
              <div>
                <h1>{profile.display_name}</h1>
                <span>@{profile.username}</span>
                <p className="presence online">
                  <i />В сети
                </p>
              </div>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => {
                  setTags(
                    profile.interests.map((name) => ({
                      name,
                      color: profile.interest_colors?.[name] || "green",
                    })),
                  );
                  setEditing((v) => !v);
                }}
              >
                {editing ? "Отмена" : "Редактировать"}
              </button>
            </div>
            {editing ? (
              <form className="profile-form" onSubmit={save}>
                <label>
                  Имя
                  <input
                    name="display_name"
                    defaultValue={profile.display_name}
                    required
                    maxLength={60}
                  />
                </label>
                <label>
                  Имя пользователя
                  <input
                    name="username"
                    defaultValue={profile.username}
                    required
                    minLength={3}
                    maxLength={24}
                    pattern="[A-Za-z0-9_]{3,24}"
                  />
                </label>
                <label className="span-2">
                  О себе
                  <textarea
                    name="bio"
                    defaultValue={profile.bio}
                    rows={4}
                    maxLength={2000}
                  />
                </label>
                <label>
                  Город
                  <input
                    name="city"
                    defaultValue={profile.city ?? ""}
                    maxLength={100}
                  />
                </label>
                <label>
                  Статус
                  <input
                    name="status_text"
                    defaultValue={profile.status_text}
                    maxLength={160}
                  />
                </label>
                <fieldset className="interest-editor">
                  <legend>Интересы</legend>
                  {tags.map((tag, index) => (
                    <div className="interest-edit-row" key={index}>
                      <input
                        aria-label={"Интерес " + (index + 1)}
                        value={tag.name}
                        maxLength={40}
                        onChange={(e) =>
                          setTags(
                            tags.map((t, i) =>
                              i === index ? { ...t, name: e.target.value } : t,
                            ),
                          )
                        }
                      />
                      <select
                        aria-label={"Цвет интереса " + (index + 1)}
                        value={tag.color}
                        onChange={(e) =>
                          setTags(
                            tags.map((t, i) =>
                              i === index ? { ...t, color: e.target.value } : t,
                            ),
                          )
                        }
                      >
                        {Object.entries(tagColors).map(([id, label]) => (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="secondary-button"
                        aria-label={"Удалить интерес " + (index + 1)}
                        onClick={() =>
                          setTags(tags.filter((_, i) => i !== index))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={tags.length >= 15}
                    onClick={() =>
                      setTags([...tags, { name: "", color: "green" }])
                    }
                  >
                    Добавить интерес
                  </button>
                  <small>До 15 интересов, каждый до 40 символов.</small>
                </fieldset>
                <button className="primary-button" disabled={busy}>
                  {busy ? "Сохраняем…" : "Сохранить"}
                </button>
              </form>
            ) : (
              <div className="profile-sections">
                <section>
                  <h2>О себе</h2>
                  <p>{profile.bio || "Не указано"}</p>
                </section>
                <section>
                  <h2>Статус</h2>
                  <p>{profile.status_text || "Не указан"}</p>
                </section>
                <section>
                  <h2>Интересы</h2>
                  <InterestTags
                    interests={profile.interests}
                    colors={profile.interest_colors}
                  />
                </section>
                <section>
                  <h2>Город</h2>
                  <p>{profile.city || "Не указан"}</p>
                </section>
                <Link className="blocked-link" to="/blocked">
                  Заблокированные пользователи
                </Link>
                <section className="account-links">
                  <h2>Настройки аккаунта</h2>
                  <Link to="/privacy">Конфиденциальность</Link>
                  <Link to="/terms">Условия</Link>
                  <Link to="/safety">Безопасность</Link>
                  <Link className="danger-link" to="/delete-account">
                    Удалить аккаунт
                  </Link>
                </section>
              </div>
            )}
            {gallery && (
              <Modal
                title="Аватарки"
                onClose={() => setGallery(false)}
                busy={busy}
              >
                <ErrorNotice error={error} />
                <div className="avatar-history">
                  {avatars.map((a) => (
                    <article key={a.id}>
                      <PrivateAvatarImage
                        src={a.public_url}
                        alt="Аватар из вашей галереи"
                      />
                      <button
                        className="secondary-button"
                        disabled={busy || profile.avatar_url === a.public_url}
                        onClick={() => void action(() => chooseAvatar(a))}
                      >
                        {profile.avatar_url === a.public_url
                          ? "Основной"
                          : "Выбрать"}
                      </button>
                      <button
                        className="danger-button"
                        disabled={busy}
                        onClick={() => setDeleting(a)}
                      >
                        Удалить
                      </button>
                    </article>
                  ))}
                </div>
                {galleryLoading && <p role="status">Загрузка аватаров…</p>}
                {!galleryLoading && !avatars.length && (
                  <div className="empty-block">
                    Загруженных аватаров пока нет
                  </div>
                )}
                <div className="profile-actions">
                  <input
                    ref={upload}
                    type="file"
                    hidden
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) void action(() => uploadAvatar(f));
                    }}
                  />
                  <button
                    className="primary-button"
                    disabled={busy}
                    onClick={() => upload.current?.click()}
                  >
                    {busy ? "Подождите…" : "Добавить аватар"}
                  </button>
                  {profile.avatar_url && (
                    <button
                      className="secondary-button"
                      disabled={busy}
                      onClick={() => void action(() => chooseAvatar(null))}
                    >
                      Использовать инициал
                    </button>
                  )}
                </div>
              </Modal>
            )}
            {deleting && (
              <Modal
                title="Удалить аватар из галереи?"
                onClose={() => setDeleting(undefined)}
                busy={busy}
              >
                <ErrorNotice error={error} />
                <p>
                  Если это основной аватар, вместо него будет показана первая
                  буква ника.
                </p>
                <button
                  className="danger-button"
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await deleteAvatar(deleting);
                      setDeleting(undefined);
                    })
                  }
                >
                  Удалить
                </button>
              </Modal>
            )}
          </>
        )
      )}
    </section>
  );
}
