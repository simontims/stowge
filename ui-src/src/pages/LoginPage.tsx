import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { saveToken } from "../lib/api";

interface LoginPageProps {
  onLogin: (token: string) => void;
}

type Mode = "checking" | "setup" | "login";

export function LoginPage({ onLogin }: LoginPageProps) {
  const [mode, setMode] = useState<Mode>("checking");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [firstname, setFirstname] = useState("");
  const [surname, setSurname] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch("/api/status");
        const data = (await res.json()) as { needs_setup?: boolean };
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
          ? { email, username: email, firstname, surname, password }
          : { username: email, email, password };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = (await res.json()) as {
        detail?: string;
        access_token?: string;
      };

      if (!res.ok) {
        setError(data.detail ?? `HTTP ${res.status}`);
        return;
      }

      if (!data.access_token) {
        setError("No token returned from server.");
        return;
      }

      saveToken(data.access_token);
      onLogin(data.access_token);
    } catch {
      setError("Network error. Please try again.");
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
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-blue-600 text-white font-bold text-xl select-none">
            S
          </div>
          <h1 className="text-lg font-semibold text-neutral-100">Stowge</h1>
        </div>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="text-sm font-semibold text-neutral-100 mb-1">
            {mode === "setup" ? "Create admin account" : "Sign in"}
          </h2>
          <p className="text-xs text-neutral-500 mb-5">
            {mode === "setup"
              ? "First-run setup — create your administrator account."
              : "Enter your credentials to access Stowge."}
          </p>

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
                    className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500 transition-colors"
                  />
                </label>
                <label className="block">
                  <span className="block text-xs text-neutral-500 mb-1">
                    Surname
                  </span>
                  <input
                    value={surname}
                    onChange={(e) => setSurname(e.target.value)}
                    autoComplete="family-name"
                    className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500 transition-colors"
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
                className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500 transition-colors"
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
                className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500 transition-colors"
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
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500 transition-colors"
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
