import { Link } from "react-router-dom";
import { useId } from "react";

type Props = {
  clickable?: boolean;
};

export function BrandMark({
  className = "brand-symbol-svg",
}: {
  className?: string;
}) {
  const gradient = useId();
  return (
    <svg
      className={className}
      viewBox="0 0 48 48"
      role="img"
      aria-label="Apchi"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e6a47d" />
          <stop offset="1" stopColor="#c77d64" />
        </linearGradient>
      </defs>
      <path
        fill={`url(#${gradient})`}
        d="M24 5C13.3 5 6 12.4 6 22.4c0 9.9 7.2 17 17.2 17 2.8 0 5.4-.5 7.7-1.6l7.6 3.3-1.7-8.1c3-3 4.7-6.8 4.7-11.1C41.5 12.3 34.4 5 24 5Z"
      />
      <path
        fill="var(--brand-cutout, #fbf8f2)"
        d="M25.1 15.2c5.3 0 8.8 3.5 8.8 8.5 0 5-3.6 8.4-8.9 8.4-5.2 0-8.9-3.5-8.9-8.4 0-5 3.8-8.5 9-8.5Z"
      />
      <path fill={`url(#${gradient})`} d="M31.7 26.8h6.5v8.6l-6.5-3.1v-5.5Z" />
    </svg>
  );
}

export function Brand({ clickable = true }: Props) {
  const content = (
    <>
      <BrandMark />
      <span className="brand-name">apchi</span>
    </>
  );

  if (!clickable) {
    return (
      <div className="brand" aria-label="Apchi">
        {content}
      </div>
    );
  }

  return (
    <Link
      className="brand brand-link"
      to="/chats"
      aria-label="Apchi — на главную"
    >
      {content}
    </Link>
  );
}
