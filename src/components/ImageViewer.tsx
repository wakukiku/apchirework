import { useEffect, useState } from "react";
import { errorText } from "../lib/logic";
import { avatarUrl } from "../services/profiles";
import { ErrorNotice } from "./ErrorNotice";
import { Modal } from "./Modal";

export function ImageViewer({
  title,
  src,
  onClose,
}: {
  title: string;
  src: string;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} className="image-viewer-modal">
      <img className="image-viewer-image" src={src} alt={title} />
    </Modal>
  );
}

export function AvatarViewer({
  title,
  canonicalUrl,
  onClose,
}: {
  title: string;
  canonicalUrl: string;
  onClose: () => void;
}) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    avatarUrl(canonicalUrl)
      .then((url) => {
        if (active && url) setSrc(url);
      })
      .catch((e) => {
        if (active) setError(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [canonicalUrl]);
  return (
    <Modal title={title} onClose={onClose} className="image-viewer-modal">
      <ErrorNotice error={error} />
      {src ? (
        <img className="image-viewer-image" src={src} alt={title} />
      ) : (
        !error && <p role="status">Загрузка изображения…</p>
      )}
    </Modal>
  );
}
