import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/ui/PageHeader";
import { SettingsSaveBar } from "../components/ui/SettingsSaveBar";
import { apiRequest } from "../lib/api";

interface ImageSettingsData {
  store_original: boolean;
  output_format: "webp" | "jpg";
  display_max_edge: number;
  display_quality: number;
  thumb_max_edge: number;
  thumb_quality: number;
}

const DEFAULTS: ImageSettingsData = {
  store_original: false,
  output_format: "webp",
  display_max_edge: 2048,
  display_quality: 82,
  thumb_max_edge: 360,
  thumb_quality: 70,
};

interface ImagesSectionProps {
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  saveFnRef?: { current: (() => Promise<void>) | null };
}

export function SettingsImagesPage({ embedded, onDirtyChange, saveFnRef }: ImagesSectionProps = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const [saved, setSaved] = useState<ImageSettingsData>(DEFAULTS);
  const [form, setForm] = useState<ImageSettingsData>(DEFAULTS);

  const isDirty = useMemo(
    () =>
      form.store_original !== saved.store_original ||
      form.output_format !== saved.output_format ||
      form.display_max_edge !== saved.display_max_edge ||
      form.display_quality !== saved.display_quality ||
      form.thumb_max_edge !== saved.thumb_max_edge ||
      form.thumb_quality !== saved.thumb_quality,
    [form, saved]
  );

  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);
  if (saveFnRef) saveFnRef.current = isDirty ? save : null;

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await apiRequest<ImageSettingsData>("/api/admin/settings/images");
      setSaved(data);
      setForm(data);
    } catch (err) {
      setError((err as Error).message || "Failed to load image settings.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const data = await apiRequest<ImageSettingsData>("/api/admin/settings/images", {
        method: "PATCH",
        body: JSON.stringify(form),
      });
      setSaved(data);
      setForm(data);
      setNotice("Settings saved.");
    } catch (err) {
      setError((err as Error).message || "Failed to save image settings.");
      throw err;
    } finally {
      setSaving(false);
    }
  }

  function field<K extends keyof ImageSettingsData>(key: K, value: ImageSettingsData[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setNotice("");
  }

  if (loading) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <div className="space-y-5">
      {!embedded && <PageHeader title="Image Settings" />}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      {/* ── Image Storage Settings ── */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-6">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">Image Storage</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Controls how images are encoded and stored when uploaded. Changes apply to future uploads only.
          </p>
        </div>

        {/* Format row */}
        <div className="flex items-start gap-6 flex-wrap">
          <div className="flex-1 min-w-[160px]">
            <p className="text-xs uppercase tracking-wide text-neutral-500 mb-2">Format</p>
            <div className="flex gap-4">
              {(["webp", "jpg"] as const).map((fmt) => (
                <label key={fmt} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="output_format"
                    value={fmt}
                    checked={form.output_format === fmt}
                    onChange={() => field("output_format", fmt)}
                    className="accent-neutral-400"
                  />
                  <span className="text-sm text-neutral-300">{fmt === "jpg" ? "JPG" : "WebP"}</span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-neutral-600">WebP produces smaller files; JPG has broader compatibility.</p>
          </div>

          <label className="flex items-start gap-3 cursor-pointer flex-1 min-w-[200px]">
            <input
              type="checkbox"
              checked={form.store_original}
              onChange={(e) => field("store_original", e.target.checked)}
              className="accent-neutral-400 w-4 h-4 mt-0.5 shrink-0"
            />
            <span className="text-sm text-neutral-300">
              Keep full-resolution copy
              <span className="block mt-0.5 text-xs text-neutral-500">
                Stores an extra full-size variant alongside the processed versions. Uses significantly more disk space.
              </span>
            </span>
          </label>
        </div>

        {/* Divider */}
        <div className="border-t border-neutral-800" />

        {/* Size & quality — side-by-side for image vs thumbnail */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

          {/* Image variant */}
          <div className="space-y-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Image</p>

            <label className="block">
              <span className="text-xs text-neutral-400">Max dimension (px)</span>
              <input
                type="number"
                min={256}
                max={8192}
                step={1}
                value={form.display_max_edge}
                onChange={(e) => field("display_max_edge", Math.max(256, Math.min(8192, parseInt(e.target.value, 10) || 2048)))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
              <p className="mt-1 text-xs text-neutral-600">Longest edge, 256–8192 px.</p>
            </label>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-400">Quality</span>
                <span className="text-sm text-neutral-200 tabular-nums">{form.display_quality}</span>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                value={form.display_quality}
                onChange={(e) => field("display_quality", parseInt(e.target.value, 10))}
                className="mt-1 w-full accent-neutral-400"
              />
              <div className="mt-1 flex justify-between text-xs text-neutral-600">
                <span>Lower</span>
                <span>Higher</span>
              </div>
            </div>
          </div>

          {/* Thumbnail variant */}
          <div className="space-y-4">
            <p className="text-xs uppercase tracking-wide text-neutral-500">Thumbnail</p>

            <label className="block">
              <span className="text-xs text-neutral-400">Max dimension (px)</span>
              <input
                type="number"
                min={64}
                max={1024}
                step={1}
                value={form.thumb_max_edge}
                onChange={(e) => field("thumb_max_edge", Math.max(64, Math.min(1024, parseInt(e.target.value, 10) || 360)))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
              <p className="mt-1 text-xs text-neutral-600">Longest edge, 64–1024 px.</p>
            </label>

            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-400">Quality</span>
                <span className="text-sm text-neutral-200 tabular-nums">{form.thumb_quality}</span>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                value={form.thumb_quality}
                onChange={(e) => field("thumb_quality", parseInt(e.target.value, 10))}
                className="mt-1 w-full accent-neutral-400"
              />
              <div className="mt-1 flex justify-between text-xs text-neutral-600">
                <span>Lower</span>
                <span>Higher</span>
              </div>
            </div>
          </div>

        </div>
      </section>

      <SettingsSaveBar
        isDirty={isDirty}
        saving={saving}
        onSave={() => void save()}
        onCancel={() => { setForm(saved); setNotice(""); setError(""); }}
      />
    </div>
  );
}
