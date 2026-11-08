import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Upload, AlertTriangle, CheckCircle } from "lucide-react";
import { apiRequest, UNAUTHORIZED_EVENT } from "../lib/api";
import { buildLocationDisplayLabel } from "../lib/locationHierarchy";
import type { LocationOption } from "../lib/types";
import { solidActionButtonClasses, outlinedActionButtonClasses } from "../components/ui/buttonStyles";

interface TagOption {
  name: string;
}

interface ToolsSectionProps {
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  saveFnRef?: { current: (() => Promise<void>) | null };
}

export function SettingsToolsPage({ embedded, onDirtyChange: _onDirtyChange, saveFnRef }: ToolsSectionProps = {}) {
  const [tags, setTags] = useState<TagOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [scope, setScope] = useState<"active" | "deleted" | "all">("active");
  const [tag, setTag] = useState("");
  const [location, setLocation] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  // Import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importError, setImportError] = useState("");
  const [importNotice, setImportNotice] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<{
    item_count: number;
    parse_errors: string[];
    missing_tags: string[];
    missing_sites: string[];
    missing_areas: string[];
    missing_locations: string[];
    invalid_tags?: string[];
  } | null>(null);

  const invalidTags = preview?.invalid_tags ?? [];

  // This page is read-only — never dirty
  useEffect(() => {
    if (saveFnRef) saveFnRef.current = null;
  }, [saveFnRef]);

  useEffect(() => {
    void loadFilters();
  }, []);

  const locationLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const row of locations) {
      labels.set(row.id, buildLocationDisplayLabel(row, locations));
    }
    return labels;
  }, [locations]);

  async function loadFilters() {
    try {
      const data = await apiRequest<{ tags: TagOption[]; locations: LocationOption[] }>(
        "/api/items/bootstrap"
      );
      setTags(data.tags || []);
      setLocations(data.locations || []);
    } catch {
      // Non-critical — filters just won't populate
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setImportFile(file);
    setPreview(null);
    setImportError("");
    setImportNotice("");
  }

  async function handlePreview() {
    if (!importFile) return;
    setPreviewing(true);
    setImportError("");
    setImportNotice("");

    const formData = new FormData();
    formData.append("file", importFile);

    try {
      const res = await fetch("/api/import/csv/preview", {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (res.status === 401) {
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
        throw new Error("Session expired. Please sign in again.");
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || `Preview failed (HTTP ${res.status})`);
      }

      setPreview(data);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  async function handleImport(
    createTags: boolean,
    createSites: boolean,
    createAreas: boolean,
    createLocations: boolean,
  ) {
    if (!importFile) return;
    setImporting(true);
    setImportError("");
    setImportNotice("");

    const params = new URLSearchParams();
    if (createTags) params.set("create_tags", "true");
    if (createSites) params.set("create_sites", "true");
    if (createAreas) params.set("create_areas", "true");
    if (createLocations) params.set("create_locations", "true");

    const formData = new FormData();
    formData.append("file", importFile);

    try {
      const res = await fetch(`/api/import/csv/confirm?${params.toString()}`, {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (res.status === 401) {
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
        throw new Error("Session expired. Please sign in again.");
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || `Import failed (HTTP ${res.status})`);
      }

      const parts: string[] = [`${data.imported} item${data.imported !== 1 ? "s" : ""} imported`];
      if (data.tags_created) parts.push(`${data.tags_created} tag${data.tags_created !== 1 ? "s" : ""} created`);
      if (data.sites_created) parts.push(`${data.sites_created} site${data.sites_created !== 1 ? "s" : ""} created`);
      if (data.areas_created) parts.push(`${data.areas_created} area${data.areas_created !== 1 ? "s" : ""} created`);
      if (data.locations_created) parts.push(`${data.locations_created} location${data.locations_created !== 1 ? "s" : ""} created`);
      setImportNotice(parts.join(", ") + ".");

      // Reset state
      setImportFile(null);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      // Reload filters in case new tags/locations were created
      void loadFilters();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    setError("");

    const params = new URLSearchParams();
    params.set("scope", scope);
    if (tag) params.set("tag", tag);
    if (location) params.set("location", location);

    try {
      const res = await fetch(`/api/export/csv?${params.toString()}`, {
        credentials: "include",
      });

      if (res.status === 401) {
        window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
        throw new Error("Session expired. Please sign in again.");
      }
      if (!res.ok) {
        const text = await res.text();
        let detail = `Export failed (HTTP ${res.status})`;
        try {
          const json = JSON.parse(text);
          if (json.detail) detail = json.detail;
        } catch { /* use default message */ }
        throw new Error(detail);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;

      // Use filename from Content-Disposition if available
      const disposition = res.headers.get("Content-Disposition");
      const match = disposition?.match(/filename="?([^"]+)"?/);
      a.download = match?.[1] ?? "stowge-export.csv";

      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setDownloading(false);
    }
  }

  const scopeOptions: Array<{ value: "active" | "deleted" | "all"; label: string }> = [
    { value: "active", label: "Active items" },
    { value: "deleted", label: "Deleted items" },
    { value: "all", label: "All items" },
  ];

  return (
    <div className="space-y-8">
      {!embedded && (
        <h1 className="text-2xl font-semibold text-heading">Tools</h1>
      )}

      {/* Export Section */}
      <section className="space-y-5">
        <div>
          <h2 className="text-lg font-medium text-heading">Export to CSV</h2>
          <p className="mt-1 text-sm text-muted">
            Download your inventory as a CSV file. Includes item name, description, tags,
            location, status, quantity, contents, and timestamps.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Scope */}
          <div>
            <label className="block text-sm font-medium text-secondary mb-1.5">Scope</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "active" | "deleted" | "all")}
              className="w-full rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm text-heading focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
            >
              {scopeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Tag Filter */}
          <div>
            <label className="block text-sm font-medium text-secondary mb-1.5">
              Tag <span className="text-subtle font-normal">(optional)</span>
            </label>
            <select
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm text-heading focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
            >
              <option value="">All tags</option>
              {tags.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Location Filter */}
          <div>
            <label className="block text-sm font-medium text-secondary mb-1.5">
              Location <span className="text-subtle font-normal">(optional)</span>
            </label>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-sm text-heading focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
            >
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.name}>
                  {locationLabels.get(l.id) || l.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p className="text-sm text-danger-400">{error}</p>
        )}

        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={downloading}
          className={`${solidActionButtonClasses("positive")} px-3 py-1.5`}
        >
          <Download className="h-4 w-4" />
          {downloading ? "Exporting…" : "Download CSV"}
        </button>
      </section>

      {/* Import Section */}
      <section className="space-y-5 border-t border-border pt-8">
        <div>
          <h2 className="text-lg font-medium text-heading">Import from CSV</h2>
          <p className="mt-1 text-sm text-muted">
            Import items from a CSV file. The file should include columns for{" "}
            <span className="text-secondary">name</span> (required),{" "}
            <span className="text-secondary">description</span>,{" "}
            <span className="text-secondary">tags</span> (separate several with <span className="text-secondary">;</span>),{" "}
            <span className="text-secondary">location</span>,{" "}
            <span className="text-secondary">status</span> (draft or confirmed), and{" "}
            <span className="text-secondary">quantity</span>.
          </p>
          <p className="mt-2 text-sm text-subtle">
            Tags and locations are matched by name (case-insensitive). If any don't exist yet,
            you'll be asked whether to create them before the import proceeds.
          </p>
          {/* Legacy CSV note: the one place the old name still appears */}
          <p className="mt-2 text-sm text-subtle">
            Older files with a <span className="text-secondary">collection</span> column still import: that value becomes one tag.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-secondary mb-1.5">CSV File</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary file:cursor-pointer hover:file:bg-surface-3 file:transition-colors"
            />
          </div>

          {importFile && !preview && (
            <button
              type="button"
              onClick={() => void handlePreview()}
              disabled={previewing}
              className={`${outlinedActionButtonClasses("neutral")} px-3 py-1.5 text-sm font-medium gap-1.5`}
            >
              <Upload className="h-4 w-4" />
              {previewing ? "Analyzing…" : "Preview Import"}
            </button>
          )}

          {preview && (
            <div className="rounded-md border border-border-strong bg-surface-2/50 p-4 space-y-3">
              <p className="text-sm text-body">
                Found <span className="font-medium text-heading">{preview.item_count}</span>{" "}
                item{preview.item_count !== 1 ? "s" : ""} to import.
              </p>

              {preview.parse_errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-warning-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Warnings ({preview.parse_errors.length})
                  </p>
                  <ul className="text-xs text-muted list-disc list-inside max-h-32 overflow-y-auto">
                    {preview.parse_errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.missing_tags.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-warning-400">
                    Missing tags ({preview.missing_tags.length})
                  </p>
                  <p className="text-xs text-muted">
                    {preview.missing_tags.join(", ")}
                  </p>
                </div>
              )}

              {preview.missing_locations.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-warning-400">
                    Missing locations ({preview.missing_locations.length})
                  </p>
                  <p className="text-xs text-muted">
                    {preview.missing_locations.join(", ")}
                  </p>
                </div>
              )}

              {preview.missing_sites.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-warning-400">
                    Missing sites ({preview.missing_sites.length})
                  </p>
                  <p className="text-xs text-muted">
                    {preview.missing_sites.join(", ")}
                  </p>
                </div>
              )}

              {preview.missing_areas.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-warning-400">
                    Missing areas ({preview.missing_areas.length})
                  </p>
                  <p className="text-xs text-muted">
                    {preview.missing_areas.join(", ")}
                  </p>
                </div>
              )}

              {invalidTags.length > 0 && (
                <div className="space-y-1 rounded-md border border-danger-800 bg-danger-950/30 p-3" role="alert">
                  <p className="text-sm font-medium text-danger-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Invalid tag names ({invalidTags.length})
                  </p>
                  <p className="text-xs text-secondary">
                    These tag names cannot be used (too short or containing ;): {invalidTags.join(", ")}
                  </p>
                  <p className="text-xs text-muted">
                    Edit the tag names in your CSV file, then choose it again to import.
                  </p>
                </div>
              )}

              {(preview.missing_tags.length > 0 || preview.missing_sites.length > 0 || preview.missing_areas.length > 0 || preview.missing_locations.length > 0) && (
                <p className="text-sm text-muted">
                  These will be created automatically when you confirm the import.
                </p>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => void handleImport(
                    preview.missing_tags.length > 0,
                    preview.missing_sites.length > 0,
                    preview.missing_areas.length > 0,
                    preview.missing_locations.length > 0,
                  )}
                  disabled={importing || preview.item_count === 0 || invalidTags.length > 0}
                  className={`${solidActionButtonClasses("positive")} px-3 py-1.5`}
                >
                  <Upload className="h-4 w-4" />
                  {importing ? "Importing…" : `Import ${preview.item_count} Item${preview.item_count !== 1 ? "s" : ""}`}
                </button>
                <button
                  type="button"
                  onClick={() => { setPreview(null); setImportFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                  disabled={importing}
                  className={`${outlinedActionButtonClasses("neutral")} px-3 py-1.5 text-sm font-medium`}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {importError && (
            <p className="text-sm text-danger-400">{importError}</p>
          )}

          {importNotice && (
            <p className="text-sm text-success-400 flex items-center gap-1.5">
              <CheckCircle className="h-4 w-4" />
              {importNotice}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
