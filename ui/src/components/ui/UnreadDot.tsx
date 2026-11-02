/** Small dot for "something new here". Decorative: pair it with a text label for screen readers. */
export function UnreadDot({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={"inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-400 " + className} />;
}
