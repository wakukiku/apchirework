import { useEffect, useState, type FormEvent } from "react";
import { Plus, Pin, Pencil, Trash2 } from "lucide-react";
import { Modal } from "../components/Modal";
import { ErrorNotice } from "../components/ErrorNotice";
import {
  deleteDraft,
  listDrafts,
  saveDraft,
  updateDraft,
} from "../services/drafts";
import { errorText, safeLink } from "../lib/logic";
import type { Draft } from "../types";
type Item = { text: string; checked: boolean };
function checklist(d: Draft): Item[] {
  const saved = d.payload.items;
  return Array.isArray(saved)
    ? saved
        .filter((i) => i && typeof i.text === "string")
        .map((i) => ({ text: i.text, checked: !!i.checked }))
    : d.body
        .split("\n")
        .filter(Boolean)
        .map((text) => ({ text, checked: false }));
}
export function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Draft | null | undefined>();
  const [kind, setKind] = useState<Draft["kind"]>("note");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Draft>();
  async function refresh() {
    try {
      setDrafts(await listDrafts());
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
  function replace(d: Draft) {
    setDrafts((list) =>
      [d, ...list.filter((x) => x.id !== d.id)].sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          b.updated_at.localeCompare(a.updated_at),
      ),
    );
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget);
    const title = String(form.get("title")).trim();
    const body = String(form.get("body") ?? "").trim();
    if (kind === "link" && !safeLink(body)) {
      setError("Введите ссылку, начинающуюся с https:// или http://");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const old = editing ? checklist(editing) : [];
      const items = body
        .split("\n")
        .filter(Boolean)
        .map((text, i) => ({
          text,
          checked: old[i]?.text === text && old[i].checked,
        }));
      replace(
        await saveDraft(
          { kind, title, body, payload: kind === "checklist" ? { items } : {} },
          editing?.id,
        ),
      );
      setEditing(undefined);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="content-panel drafts-panel">
      <div className="page-heading">
        <div>
          <h1>Черновик</h1>
          <p>Личные заметки, списки и ссылки.</p>
        </div>
        <button
          className="primary-button"
          onClick={() => {
            setKind("note");
            setEditing(null);
            setError("");
          }}
        >
          <Plus size={18} />
          Новая заметка
        </button>
      </div>
      <ErrorNotice error={error} retry={() => void refresh()} />
      {loading ? (
        <div className="empty-block">Загрузка…</div>
      ) : !drafts.length ? (
        <div className="empty-block large">
          <strong>Черновик пуст</strong>
          <span>Создайте первую заметку.</span>
        </div>
      ) : (
        <div className="draft-grid">
          {drafts.map((d) => (
            <article className={"draft-card draft-" + d.kind} key={d.id}>
              <h2>{d.title}</h2>
              {d.kind === "checklist" ? (
                <div className="checklist">
                  {checklist(d).map((item, i) => (
                    <label key={i}>
                      <input
                        type="checkbox"
                        checked={item.checked}
                        disabled={busy}
                        onChange={async () => {
                          setBusy(true);
                          try {
                            const items = checklist(d);
                            items[i].checked = !item.checked;
                            replace({ ...d, payload: { items } });
                            replace(
                              await updateDraft(d.id, { payload: { items } }),
                            );
                          } catch (e) {
                            replace(d);
                            setError(errorText(e));
                          } finally {
                            setBusy(false);
                          }
                        }}
                      />
                      <span className={item.checked ? "checked" : ""}>
                        {item.text}
                      </span>
                    </label>
                  ))}
                </div>
              ) : d.kind === "link" && safeLink(d.body) ? (
                <a
                  href={safeLink(d.body)!}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {d.body}
                </a>
              ) : d.kind === "quote" ? (
                <blockquote>{d.body}</blockquote>
              ) : (
                <p>{d.body}</p>
              )}
              <small>
                {new Date(d.updated_at).toLocaleDateString("ru-RU")}
              </small>
              <div className="draft-actions">
                <button
                  aria-label={
                    d.pinned ? "Открепить заметку" : "Закрепить заметку"
                  }
                  aria-pressed={d.pinned}
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      replace(await updateDraft(d.id, { pinned: !d.pinned }));
                    } catch (e) {
                      setError(errorText(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Pin size={17} />
                </button>
                <button
                  aria-label="Редактировать заметку"
                  onClick={() => {
                    setKind(d.kind === "voice" ? "note" : d.kind);
                    setEditing(d);
                    setError("");
                  }}
                >
                  <Pencil size={17} />
                </button>
                <button
                  aria-label="Удалить заметку"
                  onClick={() => setDeleting(d)}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {editing !== undefined && (
        <Modal
          title={editing ? "Редактировать запись" : "Новая запись"}
          onClose={() => setEditing(undefined)}
          busy={busy}
        >
          <ErrorNotice error={error} />
          <div className="draft-kind-row no-scrollbar">
            {(
              [
                ["note", "Заметка"],
                ["checklist", "Чек-лист"],
                ["link", "Ссылка"],
                ["quote", "Цитата"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={kind === value ? "active" : ""}
                onClick={() => setKind(value)}
                disabled={busy}
              >
                {label}
              </button>
            ))}
          </div>
          <form className="draft-editor-form" onSubmit={save}>
            <label>
              Название
              <input
                name="title"
                defaultValue={editing?.title ?? ""}
                maxLength={120}
                required
                autoFocus
              />
            </label>
            <label>
              {kind === "checklist"
                ? "Каждый пункт с новой строки"
                : kind === "link"
                  ? "Адрес ссылки"
                  : "Содержание"}
              <textarea
                name="body"
                defaultValue={editing?.body ?? ""}
                rows={7}
                maxLength={10000}
                required={kind === "link"}
              />
            </label>
            <button className="primary-button" disabled={busy}>
              {busy ? "Сохраняем…" : "Сохранить"}
            </button>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Удалить заметку?"
          onClose={() => setDeleting(undefined)}
          busy={busy}
        >
          <ErrorNotice error={error} />
          <p>{deleting.title}</p>
          <button
            className="danger-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await deleteDraft(deleting.id);
                setDrafts((v) => v.filter((d) => d.id !== deleting.id));
                setDeleting(undefined);
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Удалить
          </button>
        </Modal>
      )}
    </section>
  );
}
