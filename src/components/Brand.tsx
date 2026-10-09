import { Link } from "react-router-dom";

type BrandMarkProps = {
  className?: string;
};

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="32" cy="12" r="5.5" fill="var(--brand-mark-dot)" />

      <path
        d="M28.5 23C23.2 24.2 17.8 29.4 13.8 36.3C10.2 42.6 12.3 48.3 17.9 49.6C23 50.8 26.2 46.6 28.4 40.5C30.5 34.5 31.6 27.2 28.5 23Z"
        fill="var(--brand-mark-left)"
      />

      <path
        d="M35.5 23C40.8 24.2 46.2 29.4 50.2 36.3C53.8 42.6 51.7 48.3 46.1 49.6C41 50.8 37.8 46.6 35.6 40.5C33.5 34.5 32.4 27.2 35.5 23Z"
        fill="var(--brand-mark-right)"
      />
    </svg>
  );
}

type BrandProps = {
  className?: string;
  compact?: boolean;
  clickable?: boolean;
};

export function Brand({
  className = "",
  compact = false,
  clickable = true,
}: BrandProps) {
  const content = (
    <>
      <BrandMark className="brand-mark" />

      {!compact && <span className="brand-wordmark">apchi</span>}
    </>
  );

  if (!clickable) {
    return <div className={`brand ${className}`}>{content}</div>;
  }

  return (
    <Link to="/chats" className={`brand ${className}`} aria-label="Apchi">
      {content}
    </Link>
  );
}
