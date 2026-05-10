import type { ReactNode } from "react";

interface TablePaneLayoutProps {
  left: ReactNode;
  right: ReactNode;
  leftHeader?: ReactNode;
  rightHeader?: ReactNode;
  variant?: "grid" | "aside";
  rightVisible?: boolean;
  splitClassName?: string;
  leftPaneClassName?: string;
  rightPaneClassName?: string;
  rightWrapperClassName?: string;
}

/**
 * Shared two-pane shell used by table + details layouts.
 * Headers and pane classes are optional so pages can opt into extra behavior.
 */
export function TablePaneLayout({
  left,
  right,
  leftHeader,
  rightHeader,
  variant = "grid",
  rightVisible = true,
  splitClassName,
  leftPaneClassName,
  rightPaneClassName,
  rightWrapperClassName,
}: TablePaneLayoutProps) {
  const splitClass = splitClassName || (variant === "aside" ? "lg:flex lg:gap-4" : "grid gap-4 lg:grid-cols-[1.2fr_1fr]");
  const leftPaneClass = leftPaneClassName || (variant === "aside" ? "min-w-0 flex-1" : "rounded-md border border-neutral-800 p-3");
  const rightPaneClass = rightPaneClassName || (variant === "aside" ? "flex-1 p-3" : "rounded-md border border-neutral-800 p-3");
  const rightWrapperClass = rightWrapperClassName || (variant === "aside" ? "hidden lg:flex lg:w-96 lg:border-l border-neutral-800" : "");

  if (variant === "aside") {
    return (
      <div className={splitClass}>
        <div className={leftPaneClass}>
          {leftHeader}
          {left}
        </div>
        {rightVisible && (
          <div className={rightWrapperClass}>
            <div className={rightPaneClass}>
              {rightHeader}
              {right}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={splitClass}>
      <div className={leftPaneClass}>
        {leftHeader}
        {left}
      </div>
      {rightVisible && (
        <div className={rightPaneClass}>
          {rightHeader}
          {right}
        </div>
      )}
    </div>
  );
}
