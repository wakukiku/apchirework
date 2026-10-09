export function ErrorNotice({
  error,
  retry,
}: {
  error: string;
  retry?: () => void;
}) {
  return error ? (
    <div className="error-notice" role="alert">
      <span>{error}</span>
      {retry && (
        <button className="secondary-button" onClick={retry}>
          Повторить
        </button>
      )}
    </div>
  ) : null;
}
