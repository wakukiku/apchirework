import { CheckCircle2, Mail } from "lucide-react";
import { FormEvent, useState } from "react";

import { Brand } from "../components/Brand";
import { resendConfirmation, signIn, signUp } from "../services/auth";
import { errorText } from "../lib/logic";
import { Captcha, captchaConfigured } from "../components/Captcha";
import { useCallback } from "react";

type Mode = "login" | "register" | "confirm";

export function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [previousMode, setPreviousMode] = useState<"login" | "register">(
    "login",
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");

  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [resent, setResent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaCycle, setCaptchaCycle] = useState(0);
  const receiveCaptcha = useCallback(
    (token: string) => setCaptchaToken(token),
    [],
  );

  function switchMode(next: "login" | "register") {
    setPreviousMode(mode === "confirm" ? previousMode : mode);
    setMode(next);
    setError("");
    setCaptchaToken("");
    setCaptchaCycle((value) => value + 1);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");

    try {
      if (mode === "login") {
        await signIn(email.trim(), password);
        return;
      }

      if (mode === "register") {
        const data = await signUp(
          email.trim(),
          password,
          displayName.trim(),
          username.trim().replace(/^@/, ""),
          captchaToken || undefined,
        );

        if (!data.session) {
          setMode("confirm");
        }
      }
    } catch (cause) {
      if (mode === "register") {
        setCaptchaToken("");
        setCaptchaCycle((value) => value + 1);
      }
      if (
        cause &&
        typeof cause === "object" &&
        "code" in cause &&
        cause.code === "email_not_confirmed"
      )
        setMode("confirm");
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  }

  if (mode === "confirm") {
    return (
      <main className="auth-page">
        <section className="auth-card confirm-card">
          <Brand clickable={false} />

          <div className="confirm-icon">
            <Mail size={28} />
          </div>

          <h1>Подтвердите почту</h1>
          <p>
            Мы отправили письмо на <strong>{email}</strong>. Перейдите по ссылке
            в письме, затем вернитесь в Apchi.
          </p>

          {resent && (
            <div className="confirm-sent">
              <CheckCircle2 size={16} />
              Письмо отправлено ещё раз
            </div>
          )}

          {error && <p className="form-error">{error}</p>}

          <button
            type="button"
            className="primary-button"
            onClick={() => switchMode("login")}
          >
            Перейти ко входу
          </button>

          <button
            type="button"
            className="auth-text-button"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError("");
              try {
                await resendConfirmation(email.trim());
                setResent(true);
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Не удалось отправить письмо.",
                );
              } finally {
                setPending(false);
              }
            }}
          >
            Отправить письмо ещё раз
          </button>
        </section>
      </main>
    );
  }

  const register = mode === "register";

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Brand clickable={false} />

        <div className={`auth-switch ${register ? "register" : "login"}`}>
          <span className="auth-switch-indicator" aria-hidden="true" />

          <button
            type="button"
            className={!register ? "active" : ""}
            onClick={() => switchMode("login")}
          >
            Войти
          </button>
          <button
            type="button"
            className={register ? "active" : ""}
            onClick={() => switchMode("register")}
          >
            Регистрация
          </button>
        </div>

        <div className="auth-form-stage">
          <form
            key={mode}
            onSubmit={submit}
            className={`auth-form auth-form-${mode}`}
          >
            {register && (
              <>
                <label>
                  Имя
                  <input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                    maxLength={60}
                    autoComplete="name"
                  />
                </label>

                <label>
                  Имя пользователя
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    required
                    minLength={3}
                    maxLength={24}
                    pattern="[A-Za-z0-9_]{3,24}"
                    autoComplete="username"
                  />
                </label>
              </>
            )}

            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
              />
            </label>

            <label>
              Пароль
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
                autoComplete={register ? "new-password" : "current-password"}
              />
            </label>

            {error && <p className="form-error">{error}</p>}
            {register && (
              <Captcha key={captchaCycle} onToken={receiveCaptcha} />
            )}

            <button
              className="primary-button"
              disabled={
                pending || (register && captchaConfigured && !captchaToken)
              }
            >
              {pending ? "Подождите…" : register ? "Создать аккаунт" : "Войти"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
