import { useEffect, useMemo, useState } from "react";
import { Brain, CheckCircle2, Circle, Copy, Edit3, Loader2, Plus, Save, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/ui/PageHeader";
import { StatusMessage } from "../components/ui/StatusMessage";
import { ListToolbar } from "../components/ui/ListToolbar";
import { DataTable, type Column } from "../components/ui/DataTable";
import { SettingsSaveBar } from "../components/ui/SettingsSaveBar";
import { solidActionButtonClasses, tableActionButtonClasses } from "../components/ui/buttonStyles";
import { useTableSort } from "../hooks/useTableSort";
import { apiRequest } from "../lib/api";
import { useNumericField } from "../hooks/useNumericField";

interface AiConfig {
  id: string;
  name: string;
  provider: string;
  model: string;
  api_base: string | null;
  is_default: boolean;
  is_validated: boolean;
  validated_at: string | null;
  evidence_enabled: boolean;
  ai_max_edge: number;
  ai_quality: number;
}

interface AiAdminResponse {
  default_llm_id: string | null;
  configs: AiConfig[];
}

interface ProviderOption {
  value: string;
  label: string;
  api_base: string;
  models: string[];
  recommended_models?: string[];
}

interface ModelOptionGroups {
  recommended: string[];
  all: string[];
}

interface ProvidersCatalogResponse {
  providers: ProviderOption[];
}

interface ValidationInputSnapshot {
  provider: string;
  model: string;
  api_base: string;
  api_key: string;
}

interface NewConfigForm {
  name: string;
  provider: string;
  model: string;
  api_key: string;
  api_base: string;
  is_default: boolean;
  evidence_enabled: boolean;
  ai_max_edge: number;
  ai_quality: number;
}

interface EditConfigForm {
  name: string;
  provider: string;
  model: string;
  api_key: string;
  api_base: string;
  is_default: boolean;
  evidence_enabled: boolean;
  ai_max_edge: number;
  ai_quality: number;
}

type AiSortKey = "name" | "provider" | "model" | "is_validated";

const EMPTY_FORM: NewConfigForm = {
  name: "",
  provider: "",
  model: "",
  api_key: "",
  api_base: "",
  is_default: false,
  evidence_enabled: false,
  ai_max_edge: 1600,
  ai_quality: 85,
};

const PROVIDER_LOGO_URLS: Record<string, string> = {
  openai: "https://cdn.simpleicons.org/openai/ffffff",
  anthropic: "https://cdn.simpleicons.org/anthropic/ffffff",
  google: "https://cdn.simpleicons.org/google/ffffff",
  groq: "https://cdn.simpleicons.org/groq/ffffff",
  mistral: "https://cdn.simpleicons.org/mistralai/ffffff",
  openrouter: "https://cdn.simpleicons.org/openrouter/ffffff",
};

function formatRelativeTime(value: string | null): string {
  if (!value) return "never";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "unknown";

  const deltaSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (deltaSeconds < 10) return "just now";
  if (deltaSeconds < 60) return `${deltaSeconds}s ago`;

  const minutes = Math.floor(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function copyToClipboard(text: string) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
      return;
    }
  } catch {
    // Fall through to unsupported message.
  }
  toast.error("Clipboard is unavailable in this browser context.");
}

function buildValidationSignature(snapshot: ValidationInputSnapshot): string {
  return JSON.stringify({
    provider: snapshot.provider.trim().toLowerCase(),
    model: snapshot.model.trim(),
    api_base: snapshot.api_base.trim(),
    api_key: snapshot.api_key.trim(),
  });
}

interface AiSectionProps {
  embedded?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  saveFnRef?: { current: (() => Promise<void>) | null };
}

export function SettingsAiPage({ embedded, onDirtyChange, saveFnRef }: AiSectionProps = {}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([]);
  const [configs, setConfigs] = useState<AiConfig[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);

  const [addingOpen, setAddingOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<NewConfigForm>(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const { sortKey, sortDirection, handleSort } = useTableSort<AiSortKey>("name");

  const [advancedAddOpen, setAdvancedAddOpen] = useState(false);
  const [advancedEditOpen, setAdvancedEditOpen] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [validationErrorById, setValidationErrorById] = useState<Record<string, string | undefined>>({});
  const [providerLogoFailedByProvider, setProviderLogoFailedByProvider] = useState<Record<string, boolean>>({});

  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [confirmDeleteConfig, setConfirmDeleteConfig] = useState<AiConfig | null>(null);
  const [editForm, setEditForm] = useState<EditConfigForm>({
    name: "",
    provider: "",
    model: "",
    api_key: "",
    api_base: "",
    is_default: false,
    evidence_enabled: false,
    ai_max_edge: 1600,
    ai_quality: 85,
  });
  const [initialEditForm, setInitialEditForm] = useState<EditConfigForm>({
    name: "",
    provider: "",
    model: "",
    api_key: "",
    api_base: "",
    is_default: false,
    evidence_enabled: false,
    ai_max_edge: 1600,
    ai_quality: 85,
  });
  const [initialValidationState, setInitialValidationState] = useState(false);
  const [validatedSignature, setValidatedSignature] = useState<string | null>(null);
  const [validatedAtDraft, setValidatedAtDraft] = useState<string | null>(null);

  const newMaxEdgeField = useNumericField(
    form.ai_max_edge,
    (v) => setForm((f) => ({ ...f, ai_max_edge: v })),
    { min: 64, max: 4096, fallback: 1600 },
  );
  const newQualityField = useNumericField(
    form.ai_quality,
    (v) => setForm((f) => ({ ...f, ai_quality: v })),
    { min: 1, max: 100, fallback: 85 },
  );
  const editMaxEdgeField = useNumericField(
    editForm.ai_max_edge,
    (v) => setEditForm((f) => ({ ...f, ai_max_edge: v })),
    { min: 64, max: 4096, fallback: 1600 },
  );
  const editQualityField = useNumericField(
    editForm.ai_quality,
    (v) => setEditForm((f) => ({ ...f, ai_quality: v })),
    { min: 1, max: 100, fallback: 85 },
  );

  const filteredConfigs = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return configs;
    return configs.filter(
      (c) =>
        c.name.toLowerCase().includes(term) ||
        c.provider.toLowerCase().includes(term) ||
        c.model.toLowerCase().includes(term)
    );
  }, [configs, search]);
  const sortedFilteredConfigs = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const rows = [...filteredConfigs];
    rows.sort((a, b) => {
      let comparison = 0;
      if (sortKey === "is_validated") {
        comparison = Number(a.is_validated) - Number(b.is_validated);
      } else {
        comparison = String(a[sortKey]).localeCompare(String(b[sortKey]), undefined, { sensitivity: "base" });
      }
      return comparison * direction;
    });
    return rows;
  }, [filteredConfigs, sortDirection, sortKey]);
  const editingConfig = useMemo(
    () => configs.find((c) => c.id === editingId) || null,
    [configs, editingId]
  );
  const editingProviderLabel = useMemo(() => {
    if (!editingConfig) return "";
    return getProviderOption(editForm.provider || editingConfig.provider)?.label || editingConfig.provider;
  }, [editingConfig, editForm.provider, providerOptions]);
  const editingProviderKey = useMemo(
    () => (editForm.provider || editingConfig?.provider || "").trim().toLowerCase(),
    [editForm.provider, editingConfig?.provider]
  );
  const editingProviderLogoUrl = useMemo(
    () => (editingProviderKey ? PROVIDER_LOGO_URLS[editingProviderKey] || "" : ""),
    [editingProviderKey]
  );
  const showListView = !addingOpen && !editingId;

  const columns = useMemo<Column<AiConfig>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        sortable: true,
        render: (row) => (
          <div className="inline-flex items-center gap-2">
            <span>{row.name}</span>
            {row.is_default && (
              <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-emerald-600 text-emerald-700 bg-emerald-50 dark:border-emerald-500 dark:text-emerald-300 dark:bg-emerald-950/40">
                <Star size={11} />
                Default
              </span>
            )}
          </div>
        ),
      },
      {
        key: "provider",
        header: "Provider",
        sortable: true,
        render: (row) => <span className="text-neutral-300">{row.provider}</span>,
      },
      {
        key: "model",
        header: "Model",
        sortable: true,
        render: (row) => <span className="text-neutral-300">{row.model}</span>,
      },
      {
        key: "is_validated",
        header: "Validated",
        sortable: true,
        render: (row) =>
          row.is_validated ? (
            <CheckCircle2 size={16} className="text-emerald-400" aria-label="Validated" />
          ) : (
            <Circle size={16} className="text-neutral-500" aria-label="Not validated" />
          ),
      },
    ],
    [defaultId]
  );

  const currentValidationSignature = useMemo(
    () =>
      buildValidationSignature({
        provider: editForm.provider,
        model: editForm.model,
        api_base: editForm.api_base,
        api_key: editForm.api_key,
      }),
    [editForm.provider, editForm.model, editForm.api_base, editForm.api_key]
  );

  const isValidationCurrent = useMemo(
    () => validatedSignature !== null && validatedSignature === currentValidationSignature,
    [validatedSignature, currentValidationSignature]
  );

  const isEditDirty = useMemo(() => {
    const hasFieldEdits =
      editForm.name !== initialEditForm.name ||
      editForm.provider !== initialEditForm.provider ||
      editForm.model !== initialEditForm.model ||
      editForm.api_key !== "" ||
      editForm.api_base !== initialEditForm.api_base ||
      editForm.is_default !== initialEditForm.is_default ||
      editForm.evidence_enabled !== initialEditForm.evidence_enabled ||
      editForm.ai_max_edge !== initialEditForm.ai_max_edge ||
      editForm.ai_quality !== initialEditForm.ai_quality;

    const validationStateChanged = isValidationCurrent !== initialValidationState;
    return hasFieldEdits || validationStateChanged;
  }, [editForm, initialEditForm, isValidationCurrent, initialValidationState]);

  // Expose dirty state and save function when embedded
  useEffect(() => { onDirtyChange?.(isEditDirty); }, [isEditDirty, onDirtyChange]);
  if (saveFnRef) saveFnRef.current = isEditDirty ? saveEdit : null;

  const addModelOptions = useMemo(
    () => getModelOptionGroups(form.provider),
    [form.provider, providerOptions]
  );

  const editModelOptions = useMemo(
    () => getModelOptionGroups(editForm.provider),
    [editForm.provider, providerOptions]
  );

  useEffect(() => {
    void loadProviderCatalog();
    void loadConfigs();
  }, []);

  function getProviderOption(provider: string): ProviderOption | null {
    const exact = providerOptions.find((p) => p.value === provider);
    if (exact) return exact;
    if (!provider) return providerOptions[0] ?? null;
    return {
      value: provider,
      label: provider,
      api_base: "",
      models: [],
    };
  }

  function getProviderModels(provider: string): string[] {
    const selectedProvider = getProviderOption(provider);
    if (!selectedProvider) return [];
    return selectedProvider.models || [];
  }

  function getModelOptionGroups(provider: string): ModelOptionGroups {
    const selectedProvider = getProviderOption(provider);
    const allModels = getProviderModels(provider);
    const recommended = (selectedProvider?.recommended_models || []).filter((model) => allModels.includes(model));
    const used = new Set(recommended);
    return {
      recommended,
      all: allModels.filter((model) => !used.has(model)),
    };
  }

  function getDefaultModelForProvider(provider: string): string {
    const grouped = getModelOptionGroups(provider);
    return grouped.recommended[0] || grouped.all[0] || "";
  }

  async function loadProviderCatalog() {
    try {
      const data = await apiRequest<ProvidersCatalogResponse>("/api/admin/settings/ai/providers");
      if (data.providers?.length) {
        setProviderOptions(data.providers);
        const firstProvider = data.providers[0];
        const firstModel = firstProvider.models[0] || "";
        setForm((current) => ({
          ...current,
          provider: current.provider || firstProvider.value,
          model: current.model || firstModel,
          api_base: current.api_base || firstProvider.api_base,
        }));
      }
    } catch {
      // Keep current state empty if providers endpoint is unavailable.
    }
  }

  async function loadConfigs(options?: { background?: boolean }) {
    const background = options?.background ?? false;

    if (!background) {
      setLoading(true);
    }
    setError("");
    setNotice("");
    try {
      const data = await apiRequest<AiAdminResponse>("/api/admin/settings/ai");
      setConfigs(data.configs || []);
      setDefaultId(data.default_llm_id || null);
    } catch (err) {
      setConfigs([]);
      setDefaultId(null);
      setError((err as Error).message || "Failed to load AI settings.");
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }

  async function createConfig() {
    setError("");
    setNotice("");

    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!form.model.trim()) {
      setError("Model is required.");
      return;
    }
    if (!form.api_key.trim()) {
      setError("API key is required.");
      return;
    }
    if (!form.api_base.trim()) {
      setError("API base is required.");
      return;
    }

    setCreating(true);
    try {
      await apiRequest("/api/admin/settings/ai", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          provider: form.provider.trim(),
          model: form.model.trim(),
          api_key: form.api_key.trim(),
          api_base: form.api_base.trim(),
          is_default: form.is_default,
          evidence_enabled: form.evidence_enabled,
          ai_max_edge: form.ai_max_edge,
          ai_quality: form.ai_quality,
        }),
      });
      setForm(EMPTY_FORM);
      setAddingOpen(false);
      setNotice("AI model configuration added.");
      await loadConfigs();
    } catch (err) {
      setError((err as Error).message || "Failed to add AI model configuration.");
    } finally {
      setCreating(false);
    }
  }

  async function validateConfig(configId: string) {
    if (!editingConfig || editingConfig.id !== configId) return;

    setValidatingId(configId);
    setValidationErrorById((current) => ({ ...current, [configId]: undefined }));
    try {
      await apiRequest<{ ok: boolean; response_preview?: string }>(
        `/api/admin/settings/ai/${configId}/validate-draft`,
        {
          method: "POST",
          body: JSON.stringify({
            provider: editForm.provider,
            model: editForm.model,
            api_base: editForm.api_base,
            api_key: editForm.api_key,
          }),
        }
      );
      setValidatedSignature(currentValidationSignature);
      setValidatedAtDraft(new Date().toISOString());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Validation failed.";
      setValidatedSignature(null);
      setValidatedAtDraft(null);
      setValidationErrorById((current) => ({ ...current, [configId]: message }));
      const detailsText = `Validation failed for ${editingConfig.name}: ${message}`;
      toast.error("Validation failed", {
        description: (
          <div className="inline-flex items-center gap-2">
            <span>{editingConfig.name}</span>
            <button
              type="button"
              onClick={() => void copyToClipboard(detailsText)}
              className="inline-flex items-center justify-center rounded border border-red-500/50 bg-red-950/40 p-1 text-red-200 hover:text-red-100"
              aria-label="Copy validation error"
              title="Copy validation error"
            >
              <Copy size={12} />
            </button>
          </div>
        ),
        action: {
          label: "More details",
          onClick: () => {
            toast("Validation details", {
              description: (
                <div className="inline-flex items-start gap-2">
                  <span className="break-words">{message}</span>
                  <button
                    type="button"
                    onClick={() => void copyToClipboard(detailsText)}
                    className="inline-flex items-center justify-center rounded border border-slate-500/50 bg-slate-900/40 p-1 text-slate-200 hover:text-slate-100"
                    aria-label="Copy validation details"
                    title="Copy validation details"
                  >
                    <Copy size={12} />
                  </button>
                </div>
              ),
              duration: 12000,
              action: {
                label: "Copy",
                onClick: () => {
                  void copyToClipboard(detailsText);
                },
              },
            });
          },
        },
      });
    } finally {
      setValidatingId(null);
    }
  }

  async function removeConfig(config: AiConfig) {
    setError("");
    setNotice("");
    setDeletingId(config.id);
    try {
      await apiRequest(`/api/admin/settings/ai/${config.id}`, {
        method: "DELETE",
      });
      setNotice(`Removed ${config.name}.`);
      await loadConfigs();
    } catch (err) {
      setError((err as Error).message || "Failed to remove AI model.");
    } finally {
      setDeletingId(null);
    }
  }

  function startEdit(config: AiConfig) {
    const provider = getProviderOption(config.provider) ?? {
      value: config.provider,
      label: config.provider,
      api_base: (config.api_base || "").trim(),
      models: config.model ? [config.model] : [],
    };
    const models = getProviderModels(provider.value);
    const model = models.includes(config.model) ? config.model : (models[0] || config.model);

    const snapshot: EditConfigForm = {
      name: config.name,
      provider: provider.value,
      model,
      api_key: "",
      api_base: (config.api_base || "").trim() || provider.api_base,
      is_default: config.id === defaultId,
      evidence_enabled: !!config.evidence_enabled,
      ai_max_edge: config.ai_max_edge ?? 1600,
      ai_quality: config.ai_quality ?? 85,
    };
    const initialValidatedSignature = config.is_validated
      ? buildValidationSignature({
          provider: snapshot.provider,
          model: snapshot.model,
          api_base: snapshot.api_base,
          api_key: "",
        })
      : null;

    setEditingId(config.id);
    setInitialEditForm(snapshot);
    setEditForm(snapshot);
    setInitialValidationState(!!config.is_validated);
    setValidatedSignature(initialValidatedSignature);
    setValidatedAtDraft(config.validated_at);
  }

  function cancelEdit() {
    setEditingId(null);
    setUnsavedPromptOpen(false);
    setInitialValidationState(false);
    setValidatedSignature(null);
    setValidatedAtDraft(null);
  }

  async function handleUnsavedSave() {
    await saveEdit();
    // saveEdit calls cancelEdit on success
  }

  function handleUnsavedDiscard() {
    cancelEdit();
  }

  async function saveEdit() {
    if (!editingId) return;

    setError("");
    setNotice("");
    if (!editForm.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!editForm.model.trim()) {
      setError("Model is required.");
      return;
    }
    if (!editForm.api_base.trim()) {
      setError("API base is required.");
      return;
    }

    setSavingEdit(true);
    try {
      await apiRequest(`/api/admin/settings/ai/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editForm.name.trim(),
          provider: editForm.provider.trim(),
          model: editForm.model.trim(),
          api_base: editForm.api_base.trim(),
          api_key: editForm.api_key.trim() || undefined,
          is_default: editForm.is_default,
          evidence_enabled: editForm.evidence_enabled,
          ai_max_edge: editForm.ai_max_edge,
          ai_quality: editForm.ai_quality,
          validation_state: isValidationCurrent ? "validated" : "not_validated",
        }),
      });
      cancelEdit();
      setNotice("AI model configuration updated.");
      await loadConfigs();
    } catch (err) {
      setError((err as Error).message || "Failed to update AI model configuration.");
    } finally {
      setSavingEdit(false);
    }
  }

  return (
    <div className="space-y-5">
      {!embedded && (
        <PageHeader
          title="System / AI"
          description="Configure one or more LLMs for Add Item and set the default model"
        />
      )}

      {addingOpen && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-100">Add AI Model</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="inline-flex items-center gap-2 sm:col-span-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={(e) => setForm((v) => ({ ...v, is_default: e.target.checked }))}
                className="rounded border-neutral-700 bg-neutral-950"
              />
              Set as default model
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Display Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm((v) => ({ ...v, name: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                placeholder="Primary LLM"
              />
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Provider</span>
              <select
                value={form.provider}
                disabled={providerOptions.length === 0}
                onChange={(e) => {
                  const nextProvider = getProviderOption(e.target.value);
                  if (!nextProvider) return;
                  const nextDefaultModel = getDefaultModelForProvider(nextProvider.value);
                  setForm((v) => ({
                    ...v,
                    provider: nextProvider.value,
                    model: nextDefaultModel || v.model,
                    api_base: nextProvider.api_base || v.api_base,
                  }));
                }}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              >
                {providerOptions.length === 0 && <option value="">No providers available</option>}
                {providerOptions.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Model</span>
              <select
                value={form.model}
                onChange={(e) => setForm((v) => ({ ...v, model: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              >
                {addModelOptions.recommended.length > 0 && (
                  <optgroup label="Recommended">
                    {addModelOptions.recommended.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </optgroup>
                )}
                {addModelOptions.all.length > 0 && (
                  <optgroup label={addModelOptions.recommended.length > 0 ? "All Models" : "Models"}>
                    {addModelOptions.all.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">API Key</span>
              <input
                type="password"
                value={form.api_key}
                onChange={(e) => setForm((v) => ({ ...v, api_key: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                placeholder="Enter provider API key"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">API Base</span>
              <input
                value={form.api_base}
                onChange={(e) => setForm((v) => ({ ...v, api_base: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
            </label>

            {/* Advanced */}
            <div className="sm:col-span-2 border-t border-neutral-800 pt-3">
              <button
                type="button"
                onClick={() => setAdvancedAddOpen((v) => !v)}
                className="text-xs text-neutral-500 hover:text-neutral-300 flex items-center gap-1"
              >
                <span className={`transition-transform ${advancedAddOpen ? "rotate-90" : ""}`}>▶</span>
                Advanced
              </button>
              {advancedAddOpen && (
                <div className="mt-3 space-y-3">
                  <label className="block">
                    <span className="inline-flex items-center gap-2 text-sm text-neutral-300">
                      <input
                        type="checkbox"
                        checked={form.evidence_enabled}
                        onChange={(e) => setForm((v) => ({ ...v, evidence_enabled: e.target.checked }))}
                        className="rounded border-neutral-700 bg-neutral-950"
                      />
                      Include identification evidence
                    </span>
                    <p className="mt-1 text-xs text-neutral-500">
                      Report AI reasoning alongside item suggestions. Increases token usage and cost.
                    </p>
                  </label>

                  <div className="border-t border-neutral-800/70" />

                  <p className="text-xs text-neutral-500">
                    These settings control how photos are resized before they are sent to the AI for identification. The defaults (1600px and quality 85) usually give the best balance of detail, speed, and token cost.
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs uppercase tracking-wide text-neutral-500">AI image max edge (px)</span>
                      <input
                        type="number"
                        min={64}
                        max={4096}
                        {...newMaxEdgeField}
                        className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                      />
                      <p className="mt-1 text-xs text-neutral-600">Max pixel edge sent to AI. Recommended: 1600.</p>
                    </label>
                    <label className="block">
                      <span className="text-xs uppercase tracking-wide text-neutral-500">AI image quality</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        {...newQualityField}
                        className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                      />
                      <p className="mt-1 text-xs text-neutral-600">JPEG quality (1–100) for AI uploads. Recommended: 85.</p>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void createConfig()}
              disabled={creating}
              className="inline-flex h-8 items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 rounded-md text-sm leading-none font-medium transition-colors"
            >
              <Save size={14} />
              {creating ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => {
                setAddingOpen(false);
                setForm(EMPTY_FORM);
                setError("");
              }}
              className="inline-flex h-8 items-center gap-1.5 px-3 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 text-sm leading-none font-medium"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      <StatusMessage error={showListView ? "" : error} notice={notice} />

      {showListView && (
        <ListToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder="Search models…"
          loading={loading}
          action={
            <button
              onClick={() => setAddingOpen(true)}
              className={`${solidActionButtonClasses("positive")} px-3 py-1.5`}
            >
              <Plus size={14} />
              Add Model
            </button>
          }
        />
      )}

      {showListView && (
        <DataTable
          columns={columns}
          actions={{
            header: "",
            render: (cfg) => {
              const isDeleting = deletingId === cfg.id;
              return (
                <div className="inline-flex items-center gap-2">
                  <button
                    onClick={() => startEdit(cfg)}
                    className={tableActionButtonClasses("neutral")}
                  >
                    <Edit3 size={13} />
                    Edit
                  </button>
                  <button
                    onClick={() => setConfirmDeleteConfig(cfg)}
                    disabled={isDeleting}
                    className={tableActionButtonClasses("danger-hover")}
                  >
                    <Trash2 size={13} />
                    {isDeleting ? "Deleting..." : "Delete"}
                  </button>
                </div>
              );
            },
          }}
          rows={sortedFilteredConfigs}
          keyField="id"
          emptyMessage={error || (loading ? "Loading AI models..." : "No AI models configured yet.")}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSort={(key) => handleSort(key as AiSortKey)}
          footer={sortedFilteredConfigs.length > 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-2.5 text-right text-xs text-neutral-600">
                {loading ? "Loading…" : `${filteredConfigs.length} model${filteredConfigs.length !== 1 ? "s" : ""}`}
              </td>
            </tr>
          )}
        />
      )}

      {editingConfig && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <div className="rounded-lg border border-neutral-800/80 bg-neutral-950/50 p-4 flex items-center justify-between gap-4">
            <div className="min-w-0 flex items-center gap-3">
              <div className="h-11 w-11 shrink-0 rounded-md border border-neutral-800 bg-neutral-900 flex items-center justify-center text-neutral-300">
                {editingProviderLogoUrl && !providerLogoFailedByProvider[editingProviderKey] ? (
                  <img
                    src={editingProviderLogoUrl}
                    alt={`${editingProviderLabel} logo`}
                    className="h-5 w-5 object-contain"
                    onError={() =>
                      setProviderLogoFailedByProvider((state) => ({ ...state, [editingProviderKey]: true }))
                    }
                  />
                ) : (
                  <Brain size={18} />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wider text-neutral-500">Edit Provider</div>
                <div className="text-2xl leading-tight font-semibold text-neutral-100 truncate">{editingProviderLabel}</div>
              </div>
            </div>

            <div className="shrink-0 flex items-center gap-4">
              <div className="text-right text-sm leading-tight">
                <div className="text-neutral-400">
                  {validatingId === editingConfig.id
                    ? "Validating..."
                    : isValidationCurrent && validatedAtDraft
                      ? `Last validated ${formatRelativeTime(validatedAtDraft)}`
                      : "Not validated"}
                </div>
                <div className="text-neutral-300 mt-1">Tested {editForm.model}</div>
              </div>
              {isValidationCurrent ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-emerald-500/70 text-emerald-300 bg-emerald-950/40 text-sm font-medium">
                  <CheckCircle2 size={14} />
                  Validated
                </span>
              ) : validatingId === editingConfig.id ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-blue-500/70 text-blue-300 bg-blue-950/40 text-sm font-medium">
                  <Loader2 size={14} className="animate-spin" />
                  Validating...
                </span>
              ) : validationErrorById[editingConfig.id] ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-red-500/70 text-red-300 bg-red-950/40 text-sm font-medium">
                  Validation failed
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-700 text-neutral-300 bg-neutral-900 text-sm font-medium">
                  Not validated
                </span>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="inline-flex items-center gap-2 sm:col-span-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={editForm.is_default}
                onChange={(e) => setEditForm((v) => ({ ...v, is_default: e.target.checked }))}
                className="rounded border-neutral-700 bg-neutral-950"
              />
              Set as default model
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Display Name</span>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm((v) => ({ ...v, name: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Provider</span>
              <select
                value={editForm.provider}
                disabled={providerOptions.length === 0}
                onChange={(e) => {
                  const nextProvider = getProviderOption(e.target.value);
                  if (!nextProvider) return;
                  const nextDefaultModel = getDefaultModelForProvider(nextProvider.value);
                  setEditForm((v) => ({
                    ...v,
                    provider: nextProvider.value,
                    model: nextDefaultModel || v.model,
                    api_base: nextProvider.api_base || v.api_base,
                  }));
                }}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              >
                {providerOptions.length === 0 && <option value="">No providers available</option>}
                {providerOptions.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Model</span>
              <select
                value={editForm.model}
                onChange={(e) => setEditForm((v) => ({ ...v, model: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              >
                {editModelOptions.recommended.length > 0 && (
                  <optgroup label="Recommended">
                    {editModelOptions.recommended.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </optgroup>
                )}
                {editModelOptions.all.length > 0 && (
                  <optgroup label={editModelOptions.recommended.length > 0 ? "All Models" : "Models"}>
                    {editModelOptions.all.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">API Base</span>
              <input
                value={editForm.api_base}
                onChange={(e) => setEditForm((v) => ({ ...v, api_base: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">API Key (leave blank to keep current)</span>
              <input
                type="password"
                value={editForm.api_key}
                onChange={(e) => setEditForm((v) => ({ ...v, api_key: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
            </label>

            {/* Advanced */}
            <div className="sm:col-span-2 border-t border-neutral-800 pt-3">
              <button
                type="button"
                onClick={() => setAdvancedEditOpen((v) => !v)}
                className="text-xs text-neutral-500 hover:text-neutral-300 flex items-center gap-1"
              >
                <span className={`transition-transform ${advancedEditOpen ? "rotate-90" : ""}`}>▶</span>
                Advanced
              </button>
              {advancedEditOpen && (
                <div className="mt-3 space-y-3">
                  <label className="block">
                    <span className="inline-flex items-center gap-2 text-sm text-neutral-300">
                      <input
                        type="checkbox"
                        checked={editForm.evidence_enabled}
                        onChange={(e) => setEditForm((v) => ({ ...v, evidence_enabled: e.target.checked }))}
                        className="rounded border-neutral-700 bg-neutral-950"
                      />
                      Include identification evidence
                    </span>
                    <p className="mt-1 text-xs text-neutral-500">
                      Report AI reasoning alongside item suggestions. Increases token usage and cost.
                    </p>
                  </label>

                  <div className="border-t border-neutral-800/70" />

                  <p className="text-xs text-neutral-500">
                    These settings control how photos are resized before they are sent to the AI for identification. The defaults (1600px and quality 85) usually give the best balance of detail, speed, and token cost.
                  </p>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs uppercase tracking-wide text-neutral-500">AI image max edge (px)</span>
                      <input
                        type="number"
                        min={64}
                        max={4096}
                        {...editMaxEdgeField}
                        className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                      />
                      <p className="mt-1 text-xs text-neutral-600">Max pixel edge sent to AI. Recommended: 1600.</p>
                    </label>
                    <label className="block">
                      <span className="text-xs uppercase tracking-wide text-neutral-500">AI image quality</span>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        {...editQualityField}
                        className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                      />
                      <p className="mt-1 text-xs text-neutral-600">JPEG quality (1–100) for AI uploads. Recommended: 85.</p>
                    </label>
                  </div>
                </div>
              )}
            </div>
          </div>

          <SettingsSaveBar
            isDirty={isEditDirty}
            saving={savingEdit}
            onSave={() => void saveEdit()}
            onCancel={cancelEdit}
            onDelete={() => setConfirmDeleteConfig(editingConfig)}
            deleteDisabled={savingEdit}
            extraActions={
              <button
                onClick={() => void validateConfig(editingConfig.id)}
                disabled={validatingId === editingConfig.id}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-blue-500/70 bg-blue-950/30 text-blue-300 hover:text-blue-200 hover:bg-blue-900/30 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <CheckCircle2 size={14} />
                {validatingId === editingConfig.id ? "Validating..." : "Validate"}
              </button>
            }
          />
        </section>
      )}

      {confirmDeleteConfig && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-3"
          >
            <h3 className="text-sm font-semibold text-neutral-100">Delete AI Model</h3>
            <p className="text-sm text-neutral-300">
              Permanently delete <span className="font-medium text-neutral-100">{confirmDeleteConfig.name}</span>? This cannot be undone.
            </p>
            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteConfig(null)}
                disabled={deletingId === confirmDeleteConfig.id}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const cfg = confirmDeleteConfig;
                  setConfirmDeleteConfig(null);
                  await removeConfig(cfg);
                  if (editingId === cfg.id) cancelEdit();
                }}
                disabled={deletingId === confirmDeleteConfig.id}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-500/70 text-red-300 bg-red-950/30 hover:text-red-200 hover:bg-red-900/30 disabled:opacity-60"
              >
                <Trash2 size={14} />
                {deletingId === confirmDeleteConfig.id ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {unsavedPromptOpen && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-3"
          >
            <h3 className="text-sm font-semibold text-neutral-100">Unsaved Changes</h3>
            <p className="text-sm text-neutral-300">
              You have unsaved changes. Do you want to save before leaving this model?
            </p>
            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                onClick={() => setUnsavedPromptOpen(false)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
              >
                Cancel
              </button>
              <button
                onClick={handleUnsavedDiscard}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-500/70 text-red-300 bg-red-950/30 hover:text-red-200 hover:bg-red-900/30"
              >
                Discard
              </button>
              <button
                onClick={() => void handleUnsavedSave()}
                disabled={savingEdit}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-500/70 bg-emerald-950/30 text-emerald-300 hover:text-emerald-200 disabled:opacity-60"
              >
                <Save size={14} />
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
