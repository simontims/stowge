import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { apiRequest } from "../lib/api";
import { type CurrentUser } from "../lib/types";

interface LoginPageProps {
  onLogin: (user: CurrentUser) => void;
}

type Mode = "checking" | "setup" | "login";

const INPUT_CLS =
  "w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500 transition-colors";

export function LoginPage({ onLogin }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [firstname, setFirstname] = useState("");
  const [lastname, setLastname] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function checkStatus() {
      try {
        const data = await apiRequest<{ needs_setup?: boolean }>("/api/status");
        setMode(data.needs_setup ? "setup" : "login");
      } catch {
        setMode("login");
      }
    }
    void checkStatus();
  }, []);

  // Focus first relevant input after mode is resolved
  useEffect(() => {
    if (mode !== "checking") {
      requestAnimationFrame(() => firstInputRef.current?.focus());
    }
  }, [mode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (mode === "setup") {
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }
    }

    setLoading(true);
    try {
      const endpoint =
        mode === "setup" ? "/api/setup/first-admin" : "/api/login";

      const body =
        mode === "setup"
          ? { email, username: email, firstname, lastname, password }
          : { username: email, email, password };

      const data = await apiRequest<CurrentUser>(endpoint, {
        method: "POST",
        body: JSON.stringify(body),
      });

      onLogin(data);
    } catch (err) {
      setError((err as Error).message || "Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "checking") {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center">
        <Loader2 size={24} className="text-neutral-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <img src="/stowgeLogoOptimized.webp" alt="Stowge" className="w-36 h-36 select-none" />
          <h1 className="text-lg font-semibold text-neutral-100">Stowge</h1>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="text-sm font-semibold text-neutral-100 mb-1">
            {mode === "setup" ? "Welcome to Stowge" : "Sign in"}
          </h2>
          {mode === "setup" && (
          <p className="text-xs text-neutral-500 mb-5">
            <>
              Create your first user.<br />
              You&apos;ll have full access. Roles can be changed later.
            </>
          </p>
          )}

          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="space-y-3"
          >
            {mode === "setup" && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-xs text-neutral-500 mb-1">
                    Firstname
                  </span>
                  <input
                    ref={firstInputRef}
                    value={firstname}
                    onChange={(e) => setFirstname(e.target.value)}
                    autoComplete="given-name"
                    className={INPUT_CLS}
                  />
                </label>
                <label className="block">
                  <span className="block text-xs text-neutral-500 mb-1">
                    Lastname
                  </span>
                  <input
                    value={lastname}
                    onChange={(e) => setLastname(e.target.value)}
                    autoComplete="family-name"
                    className={INPUT_CLS}
                  />
                </label>
              </div>
            )}

            <label className="block">
              <span className="block text-xs text-neutral-500 mb-1">Email</span>
              <input
                ref={mode === "login" ? firstInputRef : undefined}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username email"
                required
                placeholder="you@example.com"
                className={INPUT_CLS}
              />
            </label>

            <label className="block">
              <span className="block text-xs text-neutral-500 mb-1">
                Password
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={
                  mode === "setup" ? "new-password" : "current-password"
                }
                required
                className={INPUT_CLS}
              />
            </label>

            {mode === "setup" && (
              <label className="block">
                <span className="block text-xs text-neutral-500 mb-1">
                  Confirm Password
                </span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  className={INPUT_CLS}
                />
              </label>
            )}

            {error && <p className="text-xs text-red-400 pt-1">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-1 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white py-2 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {mode === "setup" ? "Create Account" : "Sign In"}
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}
