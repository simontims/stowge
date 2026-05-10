export type SolidActionTone = "positive" | "brand";
export type OutlinedActionTone = "neutral" | "positive" | "danger" | "danger-hover";
export type TableActionTone = "neutral" | "danger-hover";

const SOLID_ACTION_BASE =
  "inline-flex items-center gap-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed";

const SOLID_ACTION_TONE: Record<SolidActionTone, string> = {
  positive: "bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white",
  brand: "bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white",
};

const OUTLINED_ACTION_BASE =
  "inline-flex items-center rounded-md border transition-colors disabled:opacity-60 disabled:cursor-not-allowed";

const TABLE_ACTION_BASE = "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border";

const OUTLINED_ACTION_TONE: Record<OutlinedActionTone, string> = {
  neutral: "border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600",
  positive: "border-emerald-500/70 bg-emerald-950/30 text-emerald-300 hover:text-emerald-200",
  danger: "border-red-500/70 text-red-300 bg-red-950/30 hover:text-red-200 hover:bg-red-900/30",
  "danger-hover": "border-neutral-700 text-neutral-400 hover:text-red-300 hover:border-red-500/70",
};

export function solidActionButtonClasses(tone: SolidActionTone): string {
  return `${SOLID_ACTION_BASE} ${SOLID_ACTION_TONE[tone]}`;
}

export function outlinedActionButtonClasses(tone: OutlinedActionTone): string {
  return `${OUTLINED_ACTION_BASE} ${OUTLINED_ACTION_TONE[tone]}`;
}

export function tableActionButtonClasses(tone: TableActionTone): string {
  return `${TABLE_ACTION_BASE} ${OUTLINED_ACTION_TONE[tone]} disabled:opacity-60 disabled:cursor-not-allowed`;
}
