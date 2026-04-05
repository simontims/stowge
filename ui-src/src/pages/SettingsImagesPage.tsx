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

      {/* ── Format & Storage ── */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-neutral-100">Format &amp; Storage</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Controls how photos are encoded when saved to the item catalogue.
            Changing these settings does not re-process existing images.
          </p>
        </div>

        {/* Image format */}
        <fieldset className="space-y-1">
          <legend className="text-xs uppercase tracking-wide text-neutral-500">Image Format</legend>
          <div className="flex gap-5 mt-1">
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
          <p className="text-xs text-neutral-600">WebP produces smaller files; JPG has broader compatibility.</p>
        </fieldset>

        {/* Store original */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.store_original}
            onChange={(e) => field("store_original", e.target.checked)}
            className="accent-neutral-400 w-4 h-4 mt-0.5 shrink-0"
          />
          <span className="text-sm text-neutral-300">
            Store original
            <span className="block mt-0.5 text-xs text-neutral-500">
              Keeps the original full-resolution image in addition to processed versions (uses significantly more storage).
            </span>
          </span>
        </label>
      </section>

      {/* ── Display Image ── */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-5">
        <h2 className="text-sm font-semibold text-neutral-100">Display Image</h2>

        {/* Display max dimension */}
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-neutral-500">Max dimension (px)</span>
          <input
            type="number"
            min={256}
            max={8192}
            step={1}
            value={form.display_max_edge}
            onChange={(e) => field("display_max_edge", Math.max(256, Math.min(8192, parseInt(e.target.value, 10) || 2048)))}
            className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
          />
          <p className="mt-1 text-xs text-neutral-600">Longest edge of the display image. 256–8192.</p>
        </label>

        {/* Image quality */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-neutral-500">Image quality</span>
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
            <span>Applies to both WebP and JPG compression.</span>
            <span>Smaller files ←→ Higher quality</span>
          </div>
        </div>
      </section>

      {/* ── Thumbnail ── */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-5">
        <h2 className="text-sm font-semibold text-neutral-100">Thumbnail</h2>

        {/* Thumbnail max dimension */}
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-neutral-500">Max dimension (px)</span>
          <input
            type="number"
            min={64}
            max={1024}
            step={1}
            value={form.thumb_max_edge}
            onChange={(e) => field("thumb_max_edge", Math.max(64, Math.min(1024, parseInt(e.target.value, 10) || 360)))}
            className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
          />
          <p className="mt-1 text-xs text-neutral-600">Longest edge of the thumbnail. 64–1024.</p>
        </label>

        {/* Thumbnail quality */}
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-neutral-500">Thumbnail quality</span>
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
            <span>Applies to both WebP and JPG compression.</span>
            <span>Smaller files ←→ Higher quality</span>
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
