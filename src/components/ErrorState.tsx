export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-2xl border border-red-500/35 bg-red-950/40 p-6 text-center shadow-lg shadow-red-900/20">
      <p className="text-sm text-red-200">{message}</p>
      <button type="button" onClick={onRetry} className="app-btn-primary mt-4">
        Try again
      </button>
    </div>
  );
}
