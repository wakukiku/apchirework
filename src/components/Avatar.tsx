import { useEffect, useState } from "react";
import { avatarUrl } from "../services/profiles";
export function PrivateAvatarImage({
  src,
  alt = "",
  onLoad,
  className,
}: {
  src: string;
  alt?: string;
  onLoad?: () => void;
  className?: string;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    setUrl("");
    avatarUrl(src)
      .then((url) => {
        if (active) setUrl(url ?? "");
      })
      .catch(() => {
        if (active) setUrl("");
      });
    return () => {
      active = false;
    };
  }, [src]);
  return url ? (
    <img
      className={className}
      src={url}
      alt={alt}
      onLoad={onLoad}
      onError={() => setUrl("")}
    />
  ) : null;
}
type Props = {
  initials: string;
  src?: string | null;
  color?: string;
  size?: "sm" | "md" | "lg";
  online?: boolean;
};
export function Avatar({
  initials,
  src,
  color = "#ca8f73",
  size = "md",
  online = false,
}: Props) {
  return (
    <span
      className={`avatar avatar-${size}`}
      style={{ background: color }}
      aria-hidden="true"
    >
      <span className="avatar-initial">{Array.from(initials)[0]}</span>
      {src && <PrivateAvatarImage src={src} />}{" "}
      {online && <i className="avatar-online" />}
    </span>
  );
}
export function initialFromUsername(username?: string | null) {
  return Array.from(
    Array.from(username?.trim().replace(/^@/, "") || "A")[0].toUpperCase(),
  )[0];
}
