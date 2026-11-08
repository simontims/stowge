export type SolidActionTone = "positive" | "brand";
export type OutlinedActionTone = "neutral" | "positive" | "danger" | "danger-hover";
export type TableActionTone = "neutral" | "danger-hover";

const SOLID_ACTION_BASE =
  "inline-flex items-center gap-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed";

const SOLID_ACTION_TONE: Record<SolidActionTone, string> = {
  positive: "bg-success-600 hover:bg-success-500 active:bg-success-700 text-on-solid",
  brand: "bg-info-600 hover:bg-info-500 active:bg-info-700 text-on-solid",
};

const OUTLINED_ACTION_BASE =
  "inline-flex items-center rounded-md border transition-colors disabled:opacity-60 disabled:cursor-not-allowed";

const TABLE_ACTION_BASE = "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border";

const OUTLINED_ACTION_TONE: Record<OutlinedActionTone, string> = {
  neutral: "border-border-strong text-secondary hover:text-heading hover:border-border-hover",
  positive: "border-success-500/70 bg-success-950/30 text-success-300 hover:text-success-200",
  danger: "border-danger-500/70 text-danger-300 bg-danger-950/30 hover:text-danger-200 hover:bg-danger-900/30",
  "danger-hover": "border-border-strong text-muted hover:text-danger-300 hover:border-danger-500/70",
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
