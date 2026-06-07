import { useEffect, useRef, useState } from "react";
import { Download, Upload, AlertTriangle, CheckCircle } from "lucide-react";
import { apiRequest, UNAUTHORIZED_EVENT } from "../lib/api";
import { solidActionButtonClasses, outlinedActionButtonClasses } from "../components/ui/buttonStyles";

interface CollectionOption {
  name: string;
}

interface LocationOption {
  id: string;
  name: string;
}

interface ToolsSectionProps {
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  saveFnRef?: { current: (() => Promise<void>) | null };
}

export function SettingsToolsPage({ embedded, onDirtyChange: _onDirtyChange, saveFnRef }: ToolsSectionProps = {}) {
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [scope, setScope] = useState<"active" | "deleted" | "all">("active");
  const [collection, setCollection] = useState("");
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
    missing_collections: string[];
    missing_locations: string[];
  } | null>(null);

  // This page is read-only — never dirty
  useEffect(() => {
    if (saveFnRef) saveFnRef.current = null;
  }, [saveFnRef]);

  useEffect(() => {
    void loadFilters();
  }, []);

  async function loadFilters() {
    try {
      const data = await apiRequest<{ collections: CollectionOption[]; locations: LocationOption[] }>(
        "/api/items/bootstrap"
      );
      setCollections(data.collections || []);
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

  async function handleImport(createCollections: boolean, createLocations: boolean) {
    if (!importFile) return;
    setImporting(true);
    setImportError("");
    setImportNotice("");

    const params = new URLSearchParams();
    if (createCollections) params.set("create_collections", "true");
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
      if (data.collections_created) parts.push(`${data.collections_created} collection${data.collections_created !== 1 ? "s" : ""} created`);
      if (data.locations_created) parts.push(`${data.locations_created} location${data.locations_created !== 1 ? "s" : ""} created`);
      setImportNotice(parts.join(", ") + ".");

      // Reset state
      setImportFile(null);
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      // Reload filters in case new collections/locations were created
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
    if (collection) params.set("collection", collection);
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
        <h1 className="text-2xl font-semibold text-neutral-100">Tools</h1>
      )}

      {/* Export Section */}
      <section className="space-y-5">
        <div>
          <h2 className="text-lg font-medium text-neutral-100">Export to CSV</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Download your inventory as a CSV file. Includes item name, description, collection,
            location, status, quantity, contents, and timestamps.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Scope */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1.5">Scope</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as "active" | "deleted" | "all")}
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
            >
              {scopeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Collection Filter */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1.5">
              Collection <span className="text-neutral-500 font-normal">(optional)</span>
            </label>
            <select
              value={collection}
              onChange={(e) => setCollection(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
            >
              <option value="">All collections</option>
              {collections.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Location Filter */}
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1.5">
              Location <span className="text-neutral-500 font-normal">(optional)</span>
            </label>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500"
            >
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.name}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-400">{error}</p>
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
      <section className="space-y-5 border-t border-neutral-800 pt-8">
        <div>
          <h2 className="text-lg font-medium text-neutral-100">Import from CSV</h2>
          <p className="mt-1 text-sm text-neutral-400">
            Import items from a CSV file. The file should include columns for{" "}
            <span className="text-neutral-300">name</span> (required),{" "}
            <span className="text-neutral-300">description</span>,{" "}
            <span className="text-neutral-300">collection</span>,{" "}
            <span className="text-neutral-300">location</span>,{" "}
            <span className="text-neutral-300">status</span> (draft or confirmed), and{" "}
            <span className="text-neutral-300">quantity</span>.
          </p>
          <p className="mt-2 text-sm text-neutral-500">
            Collections and locations are matched by name (case-insensitive). If any don't exist yet,
            you'll be asked whether to create them before the import proceeds.
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-300 mb-1.5">CSV File</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              className="block w-full text-sm text-neutral-400 file:mr-3 file:rounded-md file:border file:border-neutral-700 file:bg-neutral-800 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-neutral-300 file:cursor-pointer hover:file:bg-neutral-700 file:transition-colors"
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
            <div className="rounded-md border border-neutral-700 bg-neutral-800/50 p-4 space-y-3">
              <p className="text-sm text-neutral-200">
                Found <span className="font-medium text-neutral-100">{preview.item_count}</span>{" "}
                item{preview.item_count !== 1 ? "s" : ""} to import.
              </p>

              {preview.parse_errors.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-400 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Warnings ({preview.parse_errors.length})
                  </p>
                  <ul className="text-xs text-neutral-400 list-disc list-inside max-h-32 overflow-y-auto">
                    {preview.parse_errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {preview.missing_collections.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-400">
                    Missing collections ({preview.missing_collections.length})
                  </p>
                  <p className="text-xs text-neutral-400">
                    {preview.missing_collections.join(", ")}
                  </p>
                </div>
              )}

              {preview.missing_locations.length > 0 && (
                <div className="space-y-1">
                  <p className="text-sm font-medium text-amber-400">
                    Missing locations ({preview.missing_locations.length})
                  </p>
                  <p className="text-xs text-neutral-400">
                    {preview.missing_locations.join(", ")}
                  </p>
                </div>
              )}

              {(preview.missing_collections.length > 0 || preview.missing_locations.length > 0) && (
                <p className="text-sm text-neutral-400">
                  These will be created automatically when you confirm the import.
                </p>
              )}

              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => void handleImport(
                    preview.missing_collections.length > 0,
                    preview.missing_locations.length > 0,
                  )}
                  disabled={importing || preview.item_count === 0}
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
            <p className="text-sm text-red-400">{importError}</p>
          )}

          {importNotice && (
            <p className="text-sm text-emerald-400 flex items-center gap-1.5">
              <CheckCircle className="h-4 w-4" />
              {importNotice}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
