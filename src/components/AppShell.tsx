import {
  Archive,
  LogOut,
  MessageCircle,
  Moon,
  PencilLine,
  Sun,
  UserRound,
  UsersRound,
  Bell,
  Shield,
  Download,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../state/AuthContext";
import { useSettings } from "../state/SettingsContext";
import { getMyProfile } from "../services/profiles";
import {
  notificationEnabled,
  syncPushSubscription,
  toggleNotifications,
} from "../services/notifications";
import { supabase } from "../lib/supabase";
import { errorText } from "../lib/logic";
import { ErrorNotice } from "./ErrorNotice";
import { Avatar, initialFromUsername } from "./Avatar";
import { AuthorMark } from "./AuthorMark";
import { Brand } from "./Brand";
import type { Profile } from "../types";
import { Modal } from "./Modal";
import {
  canPromptInstall,
  isIOS,
  promptInstall,
  standalone,
  watchInstall,
} from "../services/install";
export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useSettings();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const [notify, setNotify] = useState(() => notificationEnabled(user!.id));
  const [busy, setBusy] = useState(false);
  const [installHelp, setInstallHelp] = useState(false);
  const [, setInstallRevision] = useState(0);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => watchInstall(() => setInstallRevision((v) => v + 1)), []);
  useEffect(() => {
    let active = true;
    void syncPushSubscription(user!.id)
      .then((enabled) => {
        if (active) setNotify(enabled);
      })
      .catch(() => {
        if (active) setNotify(notificationEnabled(user!.id));
      });
    return () => {
      active = false;
    };
  }, [user?.id]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      getMyProfile()
        .then((p) => {
          if (active) setProfile(p);
        })
        .catch((e) => {
          if (active) setError(errorText(e));
        });
    };
    refresh();
    window.addEventListener("apchi:profile-updated", refresh);
    return () => {
      active = false;
      window.removeEventListener("apchi:profile-updated", refresh);
    };
  }, [user?.id]);
  useEffect(() => {
    const heartbeat = () => {
      if (document.visibilityState === "visible")
        void supabase
          .from("profiles")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", user!.id)
          .then(() => {});
    };
    heartbeat();
    const timer = setInterval(heartbeat, 30000);
    document.addEventListener("visibilitychange", heartbeat);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", heartbeat);
    };
  }, [user?.id]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;

    let expandedHeight = viewport?.height ?? window.innerHeight;

    const updateViewport = () => {
      const height = viewport?.height ?? window.innerHeight;

      if (height > expandedHeight) {
        expandedHeight = height;
      }

      const active = document.activeElement;

      const composerFocused =
        (active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement) &&
        active.closest(".composer") !== null;

      const keyboardOpen = composerFocused && expandedHeight - height > 120;

      root.style.setProperty("--visual-height", `${Math.round(height)}px`);

      root.toggleAttribute("data-chat-keyboard-open", keyboardOpen);
    };

    const handleFocus = () => {
      requestAnimationFrame(updateViewport);
    };

    updateViewport();

    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    document.addEventListener("focusin", handleFocus);
    document.addEventListener("focusout", handleFocus);

    return () => {
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      document.removeEventListener("focusin", handleFocus);
      document.removeEventListener("focusout", handleFocus);

      root.removeAttribute("data-chat-keyboard-open");
      root.style.removeProperty("--visual-height");
    };
  }, []);
  useEffect(() => {
    setMenuOpen(false);
    if (
      /^\/chats\/[^/]+$/.test(location.pathname) &&
      !location.state?.fromChats
    ) {
      const target = location.pathname;
      navigate("/chats", { replace: true });
      queueMicrotask(() => navigate(target, { state: { fromChats: true } }));
    }
  }, [location.pathname, navigate]);
  useEffect(() => {
    if (!menuOpen) return;
    anchor.current
      ?.querySelector<HTMLElement>(".profile-dropdown button")
      ?.focus();
    const outside = (e: PointerEvent) => {
      if (!anchor.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        trigger.current?.focus();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const buttons = Array.from(
          anchor.current?.querySelectorAll<HTMLButtonElement>(
            ".profile-dropdown button:not(:disabled)",
          ) ?? [],
        );
        const index = buttons.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        buttons[
          (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
            buttons.length
        ]?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keys);
    };
  }, [menuOpen]);
  const links = [
    { to: "/chats", label: "Чаты", icon: MessageCircle },
    { to: "/drafts", label: "Черновик", icon: PencilLine },
    { to: "/friends", label: "Друзья", icon: UsersRound },
    { to: "/archive", label: "Архив", icon: Archive },
  ];
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-top-row">
          <div className="profile-anchor" ref={anchor}>
            <button
              className="profile-trigger"
              ref={trigger}
              aria-label="Открыть меню профиля"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <Avatar
                initials={initialFromUsername(profile?.username)}
                src={profile?.avatar_url}
                color={profile?.avatar_color}
              />
            </button>
            {menuOpen && (
              <div className="profile-dropdown">
                <button onClick={() => navigate("/profile")}>
                  <UserRound size={17} />
                  <span>Мой профиль</span>
                </button>
                <button onClick={() => navigate("/blocked")}>
                  <Shield size={17} />
                  <span>Заблокированные</span>
                </button>
                <div className="menu-divider" />
                {!standalone() && (canPromptInstall() || isIOS()) && (
                  <button
                    onClick={async () => {
                      setMenuOpen(false);
                      if (isIOS() && !canPromptInstall()) setInstallHelp(true);
                      else if (!(await promptInstall())) setInstallHelp(true);
                    }}
                  >
                    <Download size={17} />
                    <span>Установить Apchi</span>
                  </button>
                )}
                <button onClick={() => navigate("/privacy")}>
                  <Shield size={17} />
                  <span>Конфиденциальность</span>
                </button>
                <button
                  onClick={() => navigate("/delete-account")}
                  className="danger"
                >
                  <Shield size={17} />
                  <span>Удалить аккаунт</span>
                </button>
                <div className="menu-divider" />
                <button
                  className={theme === "light" ? "selected" : ""}
                  onClick={() => setTheme("light")}
                >
                  <Sun size={17} />
                  <span>Светлая тема</span>
                  {theme === "light" && <b aria-hidden="true">✓</b>}
                </button>
                <button
                  className={theme === "dark" ? "selected" : ""}
                  onClick={() => setTheme("dark")}
                >
                  <Moon size={17} />
                  <span>Тёмная тема</span>
                  {theme === "dark" && <b aria-hidden="true">✓</b>}
                </button>
                <div className="menu-divider" />
                <button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      setNotify(await toggleNotifications(user!.id));
                    } catch (e) {
                      setError(errorText(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Bell size={17} />
                  <span>
                    {notify ? "Выключить уведомления" : "Включить уведомления"}
                  </span>
                </button>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await signOut();
                    } catch (e) {
                      setError(errorText(e));
                      setBusy(false);
                    }
                  }}
                >
                  <LogOut size={17} />
                  <span>Выйти</span>
                </button>
              </div>
            )}
          </div>
          <Brand />
          <span className="header-balance" aria-hidden="true" />
        </div>
        <nav className="main-nav" aria-label="Основная навигация">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                "nav-link" + (isActive ? " active" : "")
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <ErrorNotice error={error} />
      <main className="app-frame">
        <div className="app-content">
          <Outlet />
        </div>
      </main>
      <AuthorMark />
      {installHelp && (
        <Modal title="Установить Apchi" onClose={() => setInstallHelp(false)}>
          <p>Чтобы установить Apchi на iPhone или iPad:</p>
          <ol>
            <li>Нажмите «Поделиться» в браузере.</li>
            <li>Выберите «На экран Домой».</li>
            <li>Нажмите «Добавить».</li>
          </ol>
          <p>
            На Android откройте меню браузера и выберите «Установить
            приложение», если системное окно не появилось.
          </p>
          <button
            className="primary-button"
            onClick={() => setInstallHelp(false)}
          >
            Понятно
          </button>
        </Modal>
      )}
    </div>
  );
}
