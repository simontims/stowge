import { Component, type ErrorInfo, type ReactNode } from "react";
import { outlinedActionButtonClasses } from "./ui/buttonStyles";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Render this instead of the message. `null` hides a failed optional feature silently. */
  fallback?: ReactNode;
  /** Called once when a child fails (e.g. to end a tour that could not start). */
  onError?: () => void;
  /** When this value changes (e.g. the route), a failed boundary tries its children again. */
  resetKey?: string;
}

/** Catches render and lazy-chunk load errors below it, so one failed route or chunk
 *  (for example after a redeploy removed old files) does not blank the whole app. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page failed to load", error, info.componentStack);
    this.props.onError?.();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center" role="alert">
        <p className="text-sm text-muted">Something went wrong loading this page.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={`${outlinedActionButtonClasses("neutral")} px-3 py-1.5`}
        >
          Reload
        </button>
      </div>
    );
  }
}
