import { useEffect, useRef } from "react";
const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
declare global {
  interface Window {
    turnstile?: {
      render: (node: HTMLElement, options: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}
export function Captcha({ onToken }: { onToken: (token: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sitekey) return;
    let widget = "",
      active = true;
    const render = () => {
      if (
        active &&
        host.current &&
        window.turnstile &&
        !host.current.childNodes.length
      )
        widget = window.turnstile.render(host.current, {
          sitekey,
          theme: "auto",
          callback: onToken,
          "expired-callback": () => onToken(""),
        });
    };
    let script = document.querySelector<HTMLScriptElement>(
      "script[data-apchi-turnstile]",
    );
    if (!script) {
      script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.dataset.apchiTurnstile = "true";
      document.head.append(script);
    }
    script.addEventListener("load", render);
    render();
    return () => {
      active = false;
      script?.removeEventListener("load", render);
      if (widget) window.turnstile?.remove(widget);
    };
  }, [onToken]);
  if (!sitekey) return null;
  return (
    <div className="captcha-wrap">
      <div ref={host} />
      <small>Проверка защищает регистрацию от автоматического спама.</small>
    </div>
  );
}
export const captchaConfigured = Boolean(sitekey);
