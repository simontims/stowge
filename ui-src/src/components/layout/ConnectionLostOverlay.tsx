export function ConnectionLostOverlay() {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-8 bg-neutral-950/96 px-6 text-center backdrop-blur-sm">
      <div className="flex flex-col items-center gap-3">
        <img
          src="/stowgeLogoOptimized.webp"
          alt="Stowage"
          className="h-24 w-24 rounded-2xl object-cover shadow-[0_0_40px_rgba(41,182,246,0.12)]"
        />
        <h1 className="text-2xl font-semibold tracking-wide text-white">Stowage</h1>
      </div>

      <div className="h-14 w-14 rounded-full border-4 border-neutral-700 border-t-[#29B6F6] animate-spin" />

      <div className="text-center">
        <h2 className="text-2xl font-bold text-white">Connection Lost</h2>
        <p className="mt-2 text-sm text-neutral-400">Attempting to reconnect to the server...</p>
      </div>
    </div>
  );
}
