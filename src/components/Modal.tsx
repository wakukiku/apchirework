import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current!;
    node.showModal();
    return () => {
      node.close();
      previous?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="apchi-modal"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) close.current();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) close.current();
      }}
    >
      <div className="modal-inner">
        <header>
          <h2 id={id}>{title}</h2>
          <button
            className="round-button"
            aria-label="Закрыть"
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
