import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Filter,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { apiRequest } from "../lib/api";

interface IdentifyCandidate {
  name?: string;
  description?: string;
  evidence?: string;
  confidence?: number;
  unknown?: boolean;
  category?: string;
}

interface IdentifyResponse {
  llm?: {
    id?: string;
    name?: string;
    provider?: string;
    model?: string;
  };
  ai?: {
    candidates?: IdentifyCandidate[];
  };
  stored_images?: Array<Record<string, unknown>>;
}

interface LlmOption {
  id: string;
  name: string;
  provider: string;
  model: string;
  is_default: boolean;
}

interface AiSettingsResponse {
  default_llm_id: string | null;
  configs: LlmOption[];
}

interface CategoryOption {
  id: string;
  name: string;
  ai_hint?: string | null;
}

interface MeResponse {
  preferred_add_category_id?: string | null;
}

interface PartDraft {
  name: string;
  description: string;
  category_id: string;
  status: "draft" | "confirmed";
}

type ScanFlowMode = "input" | "review";

const MAX_PHOTOS = 5;

export function ScanAddPage() {
  const [photos, setPhotos] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>("");
  const [submitAbort, setSubmitAbort] = useState<AbortController | null>(null);

  const [identifyData, setIdentifyData] = useState<IdentifyResponse | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [draft, setDraft] = useState<PartDraft>({
    name: "",
    description: "",
    category_id: "",
    status: "draft",
  });
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [preferredCategoryId, setPreferredCategoryId] = useState<string>("");

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState<string>("");
  const [mode, setMode] = useState<ScanFlowMode>("input");

  const [llmOptions, setLlmOptions] = useState<LlmOption[]>([]);
  const [selectedLlmId, setSelectedLlmId] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const candidates = useMemo(
    () => identifyData?.ai?.candidates ?? [],
    [identifyData]
  );

  const selectedCandidate = candidates[selectedIndex];

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => {
      setNotice("");
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    void loadAiSettings();
    void loadAddPreferences();
  }, []);

  useEffect(() => {
    const urls = photos.map((f) => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [photos]);

  function mergePhotos(newFiles: File[]) {
    setPhotos((current) => [...current, ...newFiles].slice(0, MAX_PHOTOS));
  }

  function removePhoto(index: number) {
    setPhotos((current) => current.filter((_, i) => i !== index));
  }

  function clearSession() {
    setIdentifyData(null);
    setSelectedIndex(0);
    setDraft({
      name: "",
      description: "",
      category_id: preferredCategoryId,
      status: "draft",
    });
    setSaveError("");
    setSubmitError("");
  }

  async function loadAddPreferences() {
    try {
      const [categoryData, meData] = await Promise.all([
        apiRequest<CategoryOption[]>("/api/categories"),
        apiRequest<MeResponse>("/api/me"),
      ]);

      const options = categoryData || [];
      setCategories(options);

      const preferred = meData.preferred_add_category_id || "";
      const validPreferred = options.some((cat) => cat.id === preferred)
        ? preferred
        : "";

      setPreferredCategoryId(validPreferred);
      setDraft((current) => ({
        ...current,
        category_id: current.category_id || validPreferred,
      }));
    } catch {
      setCategories([]);
      setPreferredCategoryId("");
    }
  }

  async function loadAiSettings() {
    try {
      const data = await apiRequest<AiSettingsResponse>("/api/settings/ai");
      const options = data.configs || [];
      setLlmOptions(options);

      const defaultId = data.default_llm_id || options.find((o) => o.is_default)?.id || options[0]?.id || "";
      setSelectedLlmId(defaultId);
    } catch {
      setLlmOptions([]);
      setSelectedLlmId("");
    }
  }

  function resetToStart() {
    setPhotos([]);
    clearSession();
    setMode("input");
  }

  function loadDraftFromCandidate(candidate: IdentifyCandidate | undefined) {
    setDraft({
      name: candidate?.name || "Unknown part",
      description: candidate?.description || "",
      category_id: preferredCategoryId,
      status: "draft",
    });
  }

  async function persistPreferredCategory(categoryId: string) {
    try {
      await apiRequest("/api/me", {
        method: "PATCH",
        body: JSON.stringify({
          preferred_add_category_id: categoryId || null,
        }),
      });
      setPreferredCategoryId(categoryId);
    } catch {
      // Keep Add flow usable even if preference persistence fails.
    }
  }

  async function onTakePicture() {
    setSubmitError("");
    const file = await takePicture();
    if (!file) return;
    mergePhotos([file]);
  }

  function onPickPhotos(files: FileList | null) {
    setSubmitError("");
    if (!files) return;
    mergePhotos(Array.from(files));
  }

  async function submitIdentify() {
    setSubmitError("");
    setSaveError("");
    setNotice("");

    if (isSubmitting && submitAbort) {
      submitAbort.abort();
      return;
    }

    if (isSubmitting) {
      return;
    }

    if (photos.length < 1) {
      setSubmitError("Add at least one photo.");
      return;
    }

    const controller = new AbortController();
    setSubmitAbort(controller);
    setIsSubmitting(true);

    try {
      const fd = new FormData();
      photos.slice(0, MAX_PHOTOS).forEach((file, idx) => {
        fd.append("images", file, `photo${idx + 1}.jpg`);
      });

      const query = new URLSearchParams({ mode: "three" });
      if (selectedLlmId) {
        query.set("llm_id", selectedLlmId);
      }
      if (draft.category_id) {
        query.set("category_id", draft.category_id);
      }

      const data = await apiRequest<IdentifyResponse>(
        `/api/identify?${query.toString()}`,
        {
          method: "POST",
          body: fd,
          signal: controller.signal,
        }
      );

      const found = data.ai?.candidates ?? [];
      if (found.length === 0) {
        setSubmitError("No candidate suggestions returned. Adjust photos and try again.");
        setIdentifyData(null);
        setMode("input");
        return;
      }

      setIdentifyData(data);
      setSelectedIndex(0);
      loadDraftFromCandidate(found[0]);
      setMode("review");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setSubmitError((err as Error).message || "Identify failed.");
      }
    } finally {
      setIsSubmitting(false);
      setSubmitAbort(null);
    }
  }

  async function savePart() {
    setSaveError("");
    setNotice("");

    const storedImages = identifyData?.stored_images ?? [];
    if (storedImages.length === 0) {
      setSaveError("No identified image set found. Run Submit for ID first.");
      return;
    }

    if (!draft.name.trim()) {
      setSaveError("Part name is required.");
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description,
        category: categories.find((cat) => cat.id === draft.category_id)?.name || null,
        status: draft.status,
        ai_primary: identifyData?.ai || selectedCandidate || null,
        ai_alternatives: candidates.length > 1 ? { candidates: candidates.slice(1) } : null,
        ai_chosen_index: selectedIndex,
        stored_images: storedImages,
      };

      const result = await apiRequest<{ id: string }>("/api/items", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setPhotos([]);
      clearSession();
      setMode("input");
      setNotice(`Part saved (${result.id}). Ready to add the next part.`);

      const main = document.querySelector("main");
      if (main instanceof HTMLElement) {
        main.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (err) {
      setSaveError((err as Error).message || "Save failed.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <PageHeader
        title="Add"
        description="Capture up to 5 photos, identify part suggestions, then edit before saving"
        action={null}
      />

      {mode === "input" && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-neutral-200">Photos</h2>
            <span className="text-xs text-neutral-500">{photos.length} / {MAX_PHOTOS}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={onTakePicture}
              disabled={photos.length >= MAX_PHOTOS || isSubmitting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-700 rounded-md text-sm text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Camera size={14} />
              Take picture
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={photos.length >= MAX_PHOTOS || isSubmitting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-700 rounded-md text-sm text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Upload size={14} />
              Pick photos
            </button>

            <button
              onClick={resetToStart}
              disabled={photos.length === 0 || isSubmitting}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-700 rounded-md text-sm text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Trash2 size={14} />
              Clear
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                onPickPhotos(e.target.files);
                e.currentTarget.value = "";
              }}
            />
          </div>

          {previewUrls.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
              {previewUrls.map((url, idx) => (
                <div key={url} className="relative border border-neutral-800 rounded-md overflow-hidden bg-neutral-950">
                  <img
                    src={url}
                    alt={`Photo ${idx + 1}`}
                    className="w-full aspect-square object-cover"
                  />
                  <button
                    onClick={() => removePhoto(idx)}
                    disabled={isSubmitting}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-neutral-200 hover:bg-black/80 disabled:opacity-60"
                    aria-label={`Remove photo ${idx + 1}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div>
            <div className="mb-3">
              <label className="block text-xs uppercase tracking-wide text-neutral-500 mb-1">
                Category
              </label>
              <select
                value={draft.category_id}
                onChange={(e) => {
                  const nextCategoryId = e.target.value;
                  setDraft((d) => ({ ...d, category_id: nextCategoryId }));
                  void persistPreferredCategory(nextCategoryId);
                }}
                className="w-full sm:w-[28rem] bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              >
                <option value="">None</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            {llmOptions.length > 1 && (
              <div className="mb-3">
                <label className="block text-xs uppercase tracking-wide text-neutral-500 mb-1">
                  AI Model
                </label>
                <select
                  value={selectedLlmId}
                  onChange={(e) => setSelectedLlmId(e.target.value)}
                  className="w-full sm:w-[28rem] bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                >
                  {llmOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.name} ({opt.model})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {llmOptions.length === 1 && (
              <p className="mb-3 text-xs text-neutral-500">
                Using AI model: {llmOptions[0].name} ({llmOptions[0].model})
              </p>
            )}

            <button
              onClick={submitIdentify}
              disabled={!isSubmitting && photos.length === 0}
              className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            >
              {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
              {submitAbort ? "Cancel" : "Submit for ID"}
            </button>
          </div>

          {submitError && <p className="text-sm text-red-400">{submitError}</p>}
        </section>
      )}

      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      {mode === "review" && identifyData && candidates.length > 0 && (
        <section className="border border-neutral-800 rounded-lg p-4 bg-neutral-900/40 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-neutral-200">Review and Edit</h2>
          </div>

          <div className="space-y-3">
              <div className="grid gap-3">
                <div>
                  <label className="block text-xs uppercase tracking-wide text-neutral-500 mb-1">
                    Name
                  </label>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                    className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wide text-neutral-500 mb-1">
                    Description
                  </label>
                  <textarea
                    rows={4}
                    value={draft.description}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, description: e.target.value }))
                    }
                    className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                  />
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-neutral-500 mb-1">
                      Status
                    </label>
                    <select
                      value={draft.status}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          status: e.target.value as "draft" | "confirmed",
                        }))
                      }
                      className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                    >
                      <option value="draft">draft</option>
                      <option value="confirmed">confirmed</option>
                    </select>
                  </div>
                </div>

                {selectedCandidate?.evidence ? (
                  <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                    <p className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
                      Evidence
                    </p>
                    <p className="text-sm text-neutral-400">{selectedCandidate.evidence}</p>
                  </div>
                ) : null}
              </div>

              <div className="sticky bottom-0 -mx-4 px-4 py-3 border-t border-neutral-800 bg-neutral-900/95 backdrop-blur md:static md:mx-0 md:px-0 md:py-0 md:border-0 md:bg-transparent md:backdrop-blur-none">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      setMode("input");
                      setSubmitError("");
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-700 rounded-md text-sm text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <RefreshCw size={14} />
                    Back to ID Inputs
                  </button>
                  <button
                    onClick={resetToStart}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-700 rounded-md text-sm text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
                  >
                    Discard
                  </button>
                  <button
                    onClick={savePart}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                  >
                    {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Save
                  </button>
                </div>
              </div>

              {saveError && <p className="text-sm text-red-400">{saveError}</p>}
          </div>
        </section>
      )}
    </div>
  );
}

async function isWindowsChrome(): Promise<boolean> {
  const ua = navigator.userAgent || "";
  const isWindows = /Windows/i.test(ua);
  const isChrome = /Chrome\/\d+/i.test(ua) && !/Edg\//i.test(ua) && !/OPR\//i.test(ua);
  return isWindows && isChrome;
}

function pickSingleImage(preferCamera: boolean): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (preferCamera) input.setAttribute("capture", "environment");
    input.style.display = "none";
    document.body.appendChild(input);

    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };

    input.addEventListener(
      "change",
      () => {
        finish(input.files?.[0] ?? null);
      },
      { once: true }
    );

    window.addEventListener(
      "focus",
      () => {
        setTimeout(() => finish(null), 400);
      },
      { once: true }
    );

    input.click();
  });
}

async function takePicture(): Promise<File | null> {
  if (await isWindowsChrome()) {
    return pickSingleImage(true);
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    return pickSingleImage(true);
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" },
    audio: false,
  });

  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    overlay.className = "fixed inset-0 z-[70] bg-black flex flex-col";

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.className = "flex-1 w-full h-full object-cover";
    video.srcObject = stream;

    const controls = document.createElement("div");
    controls.className = "flex gap-3 p-4 bg-black/70";

    const snapBtn = document.createElement("button");
    snapBtn.className =
      "flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md px-3 py-2 text-sm";
    snapBtn.textContent = "Take picture";

    const cancelBtn = document.createElement("button");
    cancelBtn.className =
      "flex-1 border border-neutral-700 text-neutral-200 rounded-md px-3 py-2 text-sm";
    cancelBtn.textContent = "Cancel";

    controls.appendChild(snapBtn);
    controls.appendChild(cancelBtn);
    overlay.appendChild(video);
    overlay.appendChild(controls);
    document.body.appendChild(overlay);

    const cleanup = () => {
      stream.getTracks().forEach((t) => t.stop());
      overlay.remove();
      window.removeEventListener("keydown", onEsc);
    };

    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cleanup();
        resolve(null);
      }
    };

    window.addEventListener("keydown", onEsc);

    cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };

    snapBtn.onclick = async () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 1280;
        canvas.height = video.videoHeight || 720;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanup();
          reject(new Error("Unable to capture frame."));
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, "image/jpeg", 0.9)
        );
        cleanup();
        if (!blob) {
          resolve(null);
          return;
        }
        resolve(new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" }));
      } catch (err) {
        cleanup();
        reject(err);
      }
    };
  });
}
