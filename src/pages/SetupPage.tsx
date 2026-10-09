export function SetupPage() {
  return (
    <main className="setup-page">
      <section className="setup-card">
        <h1>Подключите Supabase</h1>
        <p>
          Apchi не использует захардкоженные аккаунты и переписки. Для запуска
          выполните инструкции из README и заполните <code>.env.local</code>.
          Для существующей базы Stage 1.1 нужна только миграция{" "}
          <code>003_web_complete.sql</code>.
        </p>

        <pre>{`VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...`}</pre>
      </section>
    </main>
  );
}
