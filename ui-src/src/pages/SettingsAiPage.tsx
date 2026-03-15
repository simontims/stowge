import { useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Save, Star, Trash2, X } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { apiRequest } from "../lib/api";

interface AiConfig {
  id: string;
  name: string;
  provider: string;
  model: string;
  api_base: string | null;
  is_default: boolean;
  api_key_masked?: string | null;
}

interface AiAdminResponse {
  default_llm_id: string | null;
  configs: AiConfig[];
}

interface NewConfigForm {
  name: string;
  provider: string;
  model: string;
  api_key: string;
  api_base: string;
  is_default: boolean;
}

interface EditConfigForm {
  name: string;
  provider: string;
  model: string;
  api_key: string;
  api_base: string;
  is_default: boolean;
}

interface ProviderOption {
  value: string;
  label: string;
  apiBase: string;
  modelHints: string[];
}

const POPULAR_PROVIDERS: ProviderOption[] = [
  {
    value: "openai",
    label: "OpenAI",
    apiBase: "https://api.openai.com/v1",
    modelHints: [
      "openai/gpt-4o-mini",
      "openai/gpt-4.1-mini",
      "openai/gpt-4.1",
    ],
  },
  {
    value: "anthropic",
    label: "Anthropic",
    apiBase: "https://api.anthropic.com",
    modelHints: [
      "anthropic/claude-3-5-sonnet-latest",
      "anthropic/claude-3-5-haiku-latest",
      "anthropic/claude-3-opus-latest",
    ],
  },
  {
    value: "gemini",
    label: "Google Gemini",
    apiBase: "https://generativelanguage.googleapis.com",
    modelHints: [
      "gemini/gemini-1.5-pro",
      "gemini/gemini-1.5-flash",
      "gemini/gemini-2.0-flash",
    ],
  },
  {
    value: "azure",
    label: "Azure OpenAI",
    apiBase: "https://YOUR_RESOURCE_NAME.openai.azure.com",
    modelHints: [
      "azure/YOUR_DEPLOYMENT_NAME",
      "azure/gpt-4o-mini",
      "azure/gpt-4.1-mini",
    ],
  },
  {
    value: "groq",
    label: "Groq",
    apiBase: "https://api.groq.com/openai/v1",
    modelHints: [
      "groq/llama-3.1-70b-versatile",
      "groq/llama-3.1-8b-instant",
      "groq/mixtral-8x7b-32768",
    ],
  },
  {
    value: "mistral",
    label: "Mistral",
    apiBase: "https://api.mistral.ai/v1",
    modelHints: [
      "mistral/mistral-large-latest",
      "mistral/mistral-small-latest",
      "mistral/open-mixtral-8x22b",
    ],
  },
  {
    value: "xai",
    label: "xAI",
    apiBase: "https://api.x.ai/v1",
    modelHints: [
      "xai/grok-2-latest",
      "xai/grok-beta",
      "xai/grok-2-mini",
    ],
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    apiBase: "https://openrouter.ai/api/v1",
    modelHints: [
      "openrouter/openai/gpt-4o-mini",
      "openrouter/anthropic/claude-3.5-sonnet",
      "openrouter/google/gemini-1.5-pro",
    ],
  },
];

function providerOption(provider: string): ProviderOption | undefined {
  return POPULAR_PROVIDERS.find((p) => p.value === provider);
}

function providerModels(provider: string): string[] {
  return providerOption(provider)?.modelHints ?? [];
}

const EMPTY_FORM: NewConfigForm = {
  name: "",
  provider: POPULAR_PROVIDERS[0].value,
  model: POPULAR_PROVIDERS[0].modelHints[0],
  api_key: "",
  api_base: POPULAR_PROVIDERS[0].apiBase,
  is_default: false,
};

export function SettingsAiPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [configs, setConfigs] = useState<AiConfig[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);

  const [addingOpen, setAddingOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<NewConfigForm>(EMPTY_FORM);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editForm, setEditForm] = useState<EditConfigForm>({
    name: "",
    provider: POPULAR_PROVIDERS[0].value,
    model: POPULAR_PROVIDERS[0].modelHints[0],
    api_key: "",
    api_base: POPULAR_PROVIDERS[0].apiBase,
    is_default: false,
  });

  const hasConfigs = useMemo(() => configs.length > 0, [configs]);
  const editingConfig = useMemo(
    () => configs.find((c) => c.id === editingId) || null,
    [configs, editingId]
  );

  useEffect(() => {
    void loadConfigs();
  }, []);

  async function loadConfigs() {
    setLoading(true);
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
      setLoading(false);
    }
  }

  async function createConfig() {
    setError("");
    setNotice("");

    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!form.provider.trim()) {
      setError("Provider is required.");
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
          api_base: form.api_base.trim() || null,
          is_default: form.is_default,
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
    const fallbackProvider = providerOption(config.provider)?.value || POPULAR_PROVIDERS[0].value;
    const fallbackApiBase =
      (config.api_base || "").trim() ||
      providerOption(config.provider)?.apiBase ||
      POPULAR_PROVIDERS[0].apiBase;

    setEditingId(config.id);
    setEditForm({
      name: config.name,
      provider: fallbackProvider,
      model: config.model,
      api_key: "",
      api_base: fallbackApiBase,
      is_default: config.id === defaultId,
    });
  }

  async function saveEdit() {
    if (!editingId) return;

    setError("");
    setNotice("");

    if (!editForm.name.trim()) {
      setError("Name is required.");
      return;
    }
    if (!editForm.provider.trim()) {
      setError("Provider is required.");
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
        }),
      });
      setEditingId(null);
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
      <PageHeader
        title="Settings / AI"
        description="Configure one or more LLMs for Add Item and set the default model."
        action={null}
      />

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
                placeholder="OpenAI Primary"
              />
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Provider</span>
              <select
                value={form.provider}
                onChange={(e) => {
                  const nextProvider = e.target.value;
                  const nextOption = providerOption(nextProvider);
                  setForm((v) => {
                    const previousModels = providerModels(v.provider);
                    const nextModels = providerModels(nextProvider);
                    const modelWasAuto = previousModels.includes(v.model) || !v.model.trim();
                    return {
                      ...v,
                      provider: nextProvider,
                      api_base: nextOption?.apiBase || v.api_base,
                      model: modelWasAuto ? (nextModels[0] || v.model) : v.model,
                    };
                  });
                }}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              >
                {POPULAR_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Model</span>
              <input
                list="add-ai-model-options"
                value={form.model}
                onChange={(e) => setForm((v) => ({ ...v, model: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                placeholder="openai/gpt-4o-mini"
              />
              <datalist id="add-ai-model-options">
                {providerModels(form.provider).map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">API Key</span>
              <input
                type="password"
                value={form.api_key}
                onChange={(e) => setForm((v) => ({ ...v, api_key: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                placeholder="sk-..."
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">API Base</span>
              <input
                value={form.api_base}
                onChange={(e) => setForm((v) => ({ ...v, api_base: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                placeholder="https://api.openai.com/v1"
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
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void createConfig()}
              disabled={creating}
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
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
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}
      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      <div className="flex justify-end">
        {!addingOpen && (
          <button
            onClick={() => setAddingOpen(true)}
            className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          >
            <Plus size={14} />
            Add Model
          </button>
        )}
      </div>

      <section className="rounded-lg border border-neutral-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-neutral-900 border-b border-neutral-800">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Name</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Provider</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">Model</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-neutral-500 uppercase tracking-wider" aria-label="Actions" />
              </tr>
            </thead>
            <tbody className="bg-neutral-950 divide-y divide-neutral-800/70">
              {!hasConfigs ? (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-sm text-neutral-600">
                    {loading ? "Loading AI models..." : "No AI models configured yet."}
                  </td>
                </tr>
              ) : (
                configs.map((cfg) => {
                  const isDefault = cfg.id === defaultId;
                  const isDeleting = deletingId === cfg.id;
                  const isSettingDefault = settingDefaultId === cfg.id;

                  return (
                    <tr key={cfg.id} className="hover:bg-neutral-900/60 transition-colors">
                      <td className="px-4 py-2.5 text-neutral-200">
                        <div className="inline-flex items-center gap-2">
                          <span>{cfg.name}</span>
                          {isDefault && (
                            <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-amber-500/60 text-amber-300 bg-amber-950/30">
                              <Star size={11} />
                              Default
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-neutral-300">{cfg.provider}</td>
                      <td className="px-4 py-2.5 text-neutral-300">{cfg.model}</td>
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
                            onClick={() => void setDefault(cfg)}
                            disabled={isDefault || isSettingDefault}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            <Star size={13} />
                            {isSettingDefault ? "Setting..." : "Set Default"}
                          </button>
                          <button
                            onClick={() => void removeConfig(cfg)}
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

      {editingConfig && (
        <section className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-neutral-100">Edit AI Model</h2>
            <button
              onClick={() => setEditingId(null)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
            >
              <X size={13} />
              Close
            </button>
          </div>

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
                onChange={(e) => {
                  const nextProvider = e.target.value;
                  const nextOption = providerOption(nextProvider);
                  const nextModels = providerModels(nextProvider);
                  setEditForm((v) => ({
                    ...v,
                    provider: nextProvider,
                    api_base: nextOption?.apiBase || v.api_base,
                    model: providerModels(v.provider).includes(v.model) ? (nextModels[0] || v.model) : v.model,
                  }));
                }}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              >
                {POPULAR_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block sm:col-span-2">
              <span className="text-xs uppercase tracking-wide text-neutral-500">Model</span>
              <input
                list="edit-ai-model-options"
                value={editForm.model}
                onChange={(e) => setEditForm((v) => ({ ...v, model: e.target.value }))}
                className="mt-1 w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              />
              <datalist id="edit-ai-model-options">
                {providerModels(editForm.provider).map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
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
          </div>

          <button
            onClick={() => void saveEdit()}
            disabled={savingEdit}
            className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          >
            <Save size={14} />
            {savingEdit ? "Saving..." : "Save changes"}
          </button>
        </section>
      )}
    </div>
  );
}
