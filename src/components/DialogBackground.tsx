import { useEffect, useRef, useState } from "react";
import { saveBackground } from "../services/backgrounds";
import { errorText } from "../lib/logic";
import { ErrorNotice } from "./ErrorNotice";
export function DialogBackground({
  cid,
  path,
  url,
  onChange,
}: {
  cid: string;
  path: string | null;
  url: string;
  onChange: (path: string | null) => void;
}) {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  async function save(f: File | null) {
    setBusy(true);
    setError("");
    try {
      const next = await saveBackground(cid, f, path);
      onChange(next);
      if (alive.current) setFile(undefined);
    } catch (e) {
      if (alive.current) setError(errorText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="wallpaper-editor">
      <h3>Своя картинка</h3>
      <p id="background-help">
        JPG, PNG или WebP до 8 МБ и 40 мегапикселей. Рекомендуем от 1600 × 1200
        пикселей. Картинка заполнит фон без растяжения; края могут обрезаться на
        разных экранах. Оптимизируем файл для быстрой загрузки. Фон виден только
        вам.
      </p>
      <ErrorNotice error={error} />
      {(preview || url) && (
        <img
          className="wallpaper-preview"
          src={preview || url}
          alt="Предпросмотр фона"
        />
      )}
      <label>
        Выбрать картинку
        <input
          aria-describedby="background-help"
          disabled={busy}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setError("");
            if (
              !["image/jpeg", "image/png", "image/webp"].includes(f.type) ||
              !f.size ||
              f.size > 8388608
            ) {
              setError("Выберите JPG, PNG или WebP до 8 МБ.");
              return;
            }
            try {
              const bitmap = await createImageBitmap(f);
              bitmap.close();
              if (alive.current) setFile(f);
            } catch {
              if (alive.current)
                setError(
                  "Не удалось прочитать изображение. Выберите другой файл.",
                );
            }
          }}
        />
      </label>
      {file && (
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => void save(file)}
        >
          {busy ? "Сохраняем…" : "Применить фон"}
        </button>
      )}
      {(path || file) && (
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            if (path) void save(null);
            else setFile(undefined);
          }}
        >
          Убрать картинку
        </button>
      )}
    </section>
  );
}
