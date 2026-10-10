import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { attachmentUrl } from "../services/messages";
import { errorText } from "../lib/logic";
import type { Message } from "../types";
import { ImageViewer } from "./ImageViewer";
export function Attachment({
  message,
  onLoad,
}: {
  message: Message;
  onLoad?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const image = message.attachment_type?.startsWith("image/");
  useEffect(() => {
    let live = true;
    if (image && message.attachment_path)
      attachmentUrl(message.attachment_path)
        .then((u) => {
          if (live) setUrl(u);
        })
        .catch((e) => {
          if (live) setError(errorText(e));
        });
    return () => {
      live = false;
    };
  }, [message.attachment_path, image]);
  async function download() {
    if (!message.attachment_path) return;
    setBusy(true);
    setError("");
    try {
      const link = document.createElement("a");
      link.href = await attachmentUrl(
        message.attachment_path,
        message.attachment_name ?? "file",
      );
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.click();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="attachment">
      {url && image && (
        <button
          type="button"
          className="attachment-image-button"
          aria-label="Открыть изображение"
          onClick={() => setPreview(true)}
        >
          <img
            src={url}
            alt={message.attachment_name ?? "Изображение"}
            onLoad={onLoad}
            onError={() => {
              setUrl("");
              setError("Не удалось загрузить изображение.");
            }}
          />
        </button>
      )}
      {!image && (
        <button
          type="button"
          className="attachment-download"
          disabled={busy}
          onClick={() => void download()}
        >
          <Download size={16} />
          <span>
            {message.attachment_name} ·{" "}
            {Math.ceil((message.attachment_size ?? 0) / 1024)} КБ
          </span>
        </button>
      )}
      {error && <small role="alert">{error}</small>}
      {preview && url && (
        <ImageViewer
          title="Изображение"
          src={url}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  );
}
