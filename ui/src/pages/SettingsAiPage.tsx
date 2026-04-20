import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, CheckCircle2, Edit3, Plus, Save, Star, Trash2 } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { ListToolbar } from "../components/ui/ListToolbar";
import { SettingsSaveBar } from "../components/ui/SettingsSaveBar";
import { apiRequest } from "../lib/api";

interface AiConfig {
  id: string;
  name: string;
  provider: string;
  model: string;
  api_base: string | null;
  is_default: boolean;
  evidence_enabled: boolean;
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

interface NewConfigForm {
  name: string;
  provider: string;
  model: string;
  api_key: string;
  api_base: string;
  is_default: boolean;
  evidence_enabled: boolean;
}

interface EditConfigForm {
  name: string;
  provider: string;
  model: string;
  api_key: string;
  api_base: string;
  is_default: boolean;
  evidence_enabled: boolean;
}

type AiSortKey = "name" | "provider" | "model" | "evidence";

const EMPTY_FORM: NewConfigForm = {
  name: "",
  provider: "",
  model: "",
  api_key: "",
  api_base: "",
  is_default: false,
  evidence_enabled: false,
};

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
  const [sortKey, setSortKey] = useState<AiSortKey>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [validationStateById, setValidationStateById] = useState<Record<string, "success" | "error" | undefined>>({});

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
  });
  const [initialEditForm, setInitialEditForm] = useState<EditConfigForm>({
    name: "",
    provider: "",
    model: "",
    api_key: "",
    api_base: "",
    is_default: false,
    evidence_enabled: false,
  });

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
  const hasConfigs = useMemo(() => configs.length > 0, [configs]);
  const sortedFilteredConfigs = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const rows = [...filteredConfigs];
    rows.sort((a, b) => {
      let comparison = 0;
      if (sortKey === "evidence") {
        comparison = Number(a.evidence_enabled) - Number(b.evidence_enabled);
      } else {
        comparison = a[sortKey].localeCompare(b[sortKey], undefined, { sensitivity: "base" });
      }
      return comparison * direction;
    });
    return rows;
  }, [filteredConfigs, sortDirection, sortKey]);
  const editingConfig = useMemo(
    () => configs.find((c) => c.id === editingId) || null,
    [configs, editingId]
  );
  const showListView = !addingOpen && !editingId;

  function handleSort(nextKey: AiSortKey) {
    if (sortKey === nextKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDirection("asc");
  }

  const isEditDirty = useMemo(
    () =>
      editForm.name !== initialEditForm.name ||
      editForm.provider !== initialEditForm.provider ||
      editForm.model !== initialEditForm.model ||
      editForm.api_key !== "" ||
      editForm.api_base !== initialEditForm.api_base ||
      editForm.is_default !== initialEditForm.is_default ||
      editForm.evidence_enabled !== initialEditForm.evidence_enabled,
    [editForm, initialEditForm]
  );

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

  async function setDefault(config: AiConfig) {
    if (config.id === defaultId) return;
    setError("");
    setNotice("");
    setSettingDefaultId(config.id);
    try {
      await apiRequest(`/api/admin/settings/ai/${config.id}/default`, {
        method: "POST",
      });
      setNotice(`Default AI model set to ${config.name}.`);
      await loadConfigs();
    } catch (err) {
      setError((err as Error).message || "Failed to set default AI model.");
    } finally {
      setSettingDefaultId(null);
    }
  }

  async function validateConfig(config: AiConfig) {
    setValidatingId(config.id);
    setValidationStateById((v) => ({ ...v, [config.id]: undefined }));
    try {
      await apiRequest<{ ok: boolean; response_preview?: string }>(
        `/api/admin/settings/ai/${config.id}/validate`,
        {
          method: "POST",
        }
      );
      setValidationStateById((v) => ({ ...v, [config.id]: "success" }));
    } catch (err) {
      setValidationStateById((v) => ({ ...v, [config.id]: "error" }));
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
    };
    setEditingId(config.id);
    setInitialEditForm(snapshot);
    setEditForm(snapshot);
  }

  function cancelEdit() {
    setEditingId(null);
    setUnsavedPromptOpen(false);
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

            <label className="inline-flex items-center gap-2 sm:col-span-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={(e) => setForm((v) => ({ ...v, is_default: e.target.checked }))}
                className="rounded border-neutral-700 bg-neutral-950"
              />
              Set as default model
            </label>

            <label className="block sm:col-span-2 rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2">
              <span className="inline-flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={form.evidence_enabled}
                  onChange={(e) => setForm((v) => ({ ...v, evidence_enabled: e.target.checked }))}
                  className="rounded border-neutral-700 bg-neutral-950"
                />
                Include identiticaton evidence
              </span>
              <p className="mt-1 text-xs text-neutral-500">
                Turning this on will report evidence for AI item identification in the Add Item flow. This increases token usage and AI cost.
              </p>
            </label>
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

      {error && !showListView && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      {showListView && (
        <ListToolbar
          search={search}
          onSearchChange={setSearch}
          placeholder="Search models…"
          loading={loading}
          action={
            <button
              onClick={() => setAddingOpen(true)}
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            >
              <Plus size={14} />
              Add Model
            </button>
          }
        />
      )}

      {showListView && (
      <section className="rounded-lg border border-neutral-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-neutral-900 border-b border-neutral-800">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  <button
                    type="button"
                    onClick={() => handleSort("name")}
                    className="inline-flex items-center gap-1 hover:text-neutral-300"
                  >
                    Name
                    <ArrowUpDown size={12} className={sortKey === "name" ? "text-neutral-300" : "text-neutral-600"} />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  <button
                    type="button"
                    onClick={() => handleSort("provider")}
                    className="inline-flex items-center gap-1 hover:text-neutral-300"
                  >
                    Provider
                    <ArrowUpDown size={12} className={sortKey === "provider" ? "text-neutral-300" : "text-neutral-600"} />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  <button
                    type="button"
                    onClick={() => handleSort("model")}
                    className="inline-flex items-center gap-1 hover:text-neutral-300"
                  >
                    Model
                    <ArrowUpDown size={12} className={sortKey === "model" ? "text-neutral-300" : "text-neutral-600"} />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                  <button
                    type="button"
                    onClick={() => handleSort("evidence")}
                    className="inline-flex items-center gap-1 hover:text-neutral-300"
                  >
                    Evidence
                    <ArrowUpDown size={12} className={sortKey === "evidence" ? "text-neutral-300" : "text-neutral-600"} />
                  </button>
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="bg-neutral-950 divide-y divide-neutral-800/70">
              {error ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-neutral-500">
                    {error}
                  </td>
                </tr>
              ) : !hasConfigs ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-neutral-600">
                    {loading ? "Loading AI models..." : "No AI models configured yet."}
                  </td>
                </tr>
              ) : (
                sortedFilteredConfigs.map((cfg) => {
                  const isDefault = cfg.id === defaultId;
                  const isDeleting = deletingId === cfg.id;
                  const isSettingDefault = settingDefaultId === cfg.id;
                  const isValidating = validatingId === cfg.id;
                  const validationState = validationStateById[cfg.id];
                  return (
                    <tr key={cfg.id} className="hover:bg-neutral-900/60 transition-colors">
                      <td className="px-4 py-2.5 text-neutral-200">
                        <div className="inline-flex items-center gap-2">
                          <span>{cfg.name}</span>
                          {isDefault && (
                            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-emerald-600 text-emerald-700 bg-emerald-50 dark:border-emerald-500 dark:text-emerald-300 dark:bg-emerald-950/40">
                              <Star size={11} />
                              Default
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-neutral-300">{cfg.provider}</td>
                      <td className="px-4 py-2.5 text-neutral-300">{cfg.model}</td>
                      <td className="px-4 py-2.5">
                        <span
                          className={[
                            "inline-flex items-center px-2 py-0.5 rounded border text-xs",
                            cfg.evidence_enabled
                              ? "border-emerald-500/70 text-emerald-300 bg-emerald-950/30"
                              : "border-neutral-700 text-neutral-400 bg-neutral-900",
                          ].join(" ")}
                        >
                          {cfg.evidence_enabled ? "On" : "Off"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => startEdit(cfg)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
                          >
                            <Edit3 size={13} />
                            Edit
                          </button>
                          <button
                            onClick={() => void validateConfig(cfg)}
                            disabled={isValidating}
                            className={[
                              "inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border disabled:opacity-60 disabled:cursor-not-allowed",
                              validationState === "success"
                                ? "border-emerald-500/70 text-emerald-300 bg-emerald-950/30"
                                : validationState === "error"
                                  ? "border-red-500/70 text-red-300 bg-red-950/30"
                                  : "border-neutral-700 text-neutral-300 hover:text-emerald-300 hover:border-emerald-500/70",
                            ].join(" ")}
                          >
                            <CheckCircle2 size={13} />
                            {isValidating ? "Validating..." : validationState === "success" ? "Passed" : validationState === "error" ? "Failed" : "Validate"}
                          </button>
                          <button
                            onClick={() => void setDefault(cfg)}
                            disabled={isDefault || isSettingDefault}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <Star size={13} />
                            {isSettingDefault ? "Setting..." : "Set Default"}
                          </button>
                          <button
                            onClick={() => setConfirmDeleteConfig(cfg)}
                            disabled={isDeleting}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-red-300 hover:border-red-500/70 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <Trash2 size={13} />
                            {isDeleting ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {showListView && hasConfigs && !error && (
        <p className="text-xs text-neutral-600 text-right">
          {loading ? "Loading…" : `${filteredConfigs.length} model${filteredConfigs.length !== 1 ? "s" : ""}`}
        </p>
      )}

      {editingConfig && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-100">Edit AI Model</h2>

          <p className="text-sm text-neutral-500">Editing {editingConfig.name}</p>

          <div className="grid gap-3 sm:grid-cols-2">
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

            <label className="inline-flex items-center gap-2 sm:col-span-2 text-sm text-neutral-300">
              <input
                type="checkbox"
                checked={editForm.is_default}
                onChange={(e) => setEditForm((v) => ({ ...v, is_default: e.target.checked }))}
                className="rounded border-neutral-700 bg-neutral-950"
              />
              Set as default model
            </label>

            <label className="block sm:col-span-2 rounded-md border border-neutral-800 bg-neutral-950/60 px-3 py-2">
              <span className="inline-flex items-center gap-2 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={editForm.evidence_enabled}
                  onChange={(e) => setEditForm((v) => ({ ...v, evidence_enabled: e.target.checked }))}
                  className="rounded border-neutral-700 bg-neutral-950"
                />
                Include identiticaton evidence
              </span>
              <p className="mt-1 text-xs text-neutral-500">
                Turning this on will report evidence for AI item identification in the Add Item flow. This increases token usage and AI cost.
              </p>
            </label>
          </div>

          <SettingsSaveBar
            isDirty={isEditDirty}
            saving={savingEdit}
            onSave={() => void saveEdit()}
            onCancel={cancelEdit}
            onDelete={() => setConfirmDeleteConfig(editingConfig)}
            deleteDisabled={savingEdit}
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
