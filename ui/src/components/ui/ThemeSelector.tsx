import { Moon, Sun } from "lucide-react";
import clsx from "clsx";
import { chooseTheme, useTheme, type ThemeMode } from "../../lib/theme";

const OPTIONS: Array<{ value: ThemeMode; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

interface ThemeSelectorProps {
  /** Unique id prefix, so two selectors on one page do not share radio ids. */
  idPrefix: string;
  /** Show the helper line under the control. */
  showHint?: boolean;
}

/** Light / Dark choice as a native radio group (arrow keys and screen-reader semantics come with it).
 *  Picking one applies and saves it at once, so the page behind it changes immediately. */
export function ThemeSelector({ idPrefix, showHint = false }: ThemeSelectorProps) {
  const theme = useTheme();
  return (
    <fieldset>
      <legend className="text-xs font-medium uppercase tracking-wide text-muted">Appearance</legend>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {OPTIONS.map(({ value, label, Icon }) => (
          <label
            key={value}
            htmlFor={`${idPrefix}-${value}`}
            className={clsx(
              "flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border text-sm transition-colors",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-border-focus",
              theme === value
                ? "border-border-focus bg-surface-3 text-heading"
                : "border-border-strong text-secondary hover:border-border-hover hover:text-heading",
            )}
          >
            <input
              id={`${idPrefix}-${value}`}
              type="radio"
              name={`${idPrefix}-theme`}
              value={value}
              checked={theme === value}
              onChange={() => chooseTheme(value)}
              className="sr-only"
            />
            <Icon size={14} aria-hidden="true" />
            {label}
          </label>
        ))}
      </div>
      {showHint && <p className="mt-2 text-xs text-subtle">You can change this later with the sun or moon button in the top bar.</p>}
    </fieldset>
  );
}
