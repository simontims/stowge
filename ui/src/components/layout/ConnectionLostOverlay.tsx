export function ConnectionLostOverlay() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8 bg-surface px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <img
          src="/stowgeLogoOptimized.webp"
          alt="Stowge"
          className="w-36 h-36 select-none"
        />
        <h1 className="text-lg font-semibold text-heading">Stowge</h1>
      </div>

      <div className="connection-lost-spinner h-14 w-14 rounded-full border-4 border-border-strong border-t-info-400 animate-spin" />

      <div className="text-center">
        <h2 className="text-base font-bold text-heading">Connection Lost</h2>
        <p className="mt-2 text-sm text-muted">Attempting to reconnect to the server...</p>
      </div>
    </div>
  );
}
