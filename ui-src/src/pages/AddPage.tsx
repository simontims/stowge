import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  Camera,
  Loader2,
  RefreshCw,
  Save,
  Upload,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { apiRequest } from "../lib/api";

interface IdentifyCandidate {
  name?: string;
  description?: string;
  evidence?: string;
  confidence?: number;
  unknown?: boolean;
  collection?: string;
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

interface StoreImagesResponse {
  stored_images?: Array<Record<string, unknown>>;
}

interface DiscardImagesResponse {
  requested: number;
  deleted: number;
  skipped_linked: number;
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

interface CollectionOption {
  id: string;
  name: string;
  ai_hint?: string | null;
}

interface LocationOption {
  id: string;
  name: string;
}

interface MeResponse {
  preferred_add_collection_id?: string | null;
}

interface PartDraft {
  name: string;
  description: string;
  collection_id: string;
  location_id: string;
  status: "draft" | "confirmed";
}

type ScanFlowMode = "input" | "review";

const MAX_PHOTOS = 5;

interface PhotoControlsProps {
  previewUrls: string[];
  photoCount: number;
  maxPhotos: number;
  disabled: boolean;
  onTakePicture: () => void;
  onPickPhotos: () => void;
  onRemovePhoto: (index: number) => void;
}

function PhotoControls({
  previewUrls,
  photoCount,
  maxPhotos,
  disabled,
  onTakePicture,
  onPickPhotos,
  onRemovePhoto,
}: PhotoControlsProps) {
  return (
    <div className="space-y-3">
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
                onClick={() => onRemovePhoto(idx)}
                disabled={disabled}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-neutral-200 hover:bg-black/80 disabled:opacity-60"
                aria-label={`Remove photo ${idx + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onTakePicture}
          disabled={photoCount >= maxPhotos || disabled}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-700 rounded-md text-sm text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Camera size={14} />
          Take picture
        </button>

        <button
          onClick={onPickPhotos}
          disabled={photoCount >= maxPhotos || disabled}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-700 rounded-md text-sm text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Upload size={14} />
          Pick photos
        </button>

        <span className="text-xs text-neutral-500">{photoCount} / {maxPhotos}</span>
      </div>
    </div>
  );
}

export function AddPage() {
  const [searchParams] = useSearchParams();
  const [photos, setPhotos] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string>("");
  const [submitErrorDetail, setSubmitErrorDetail] = useState<string>("");
  const [submitErrorProvider, setSubmitErrorProvider] = useState<string>("");
  const [submitErrorModel, setSubmitErrorModel] = useState<string>("");
  const [showSubmitErrorDetail, setShowSubmitErrorDetail] = useState(false);
  const [submitErrorCopied, setSubmitErrorCopied] = useState(false);
  const [submitAbort, setSubmitAbort] = useState<AbortController | null>(null);

  const [identifyData, setIdentifyData] = useState<IdentifyResponse | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [draft, setDraft] = useState<PartDraft>({
    name: "",
    description: "",
    collection_id: "",
    location_id: "",
    status: "draft",
  });
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [preferredCollectionId, setPreferredCollectionId] = useState<string>("");

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState<string>("");
  const [mode, setMode] = useState<ScanFlowMode>("input");

  const [llmOptions, setLlmOptions] = useState<LlmOption[]>([]);
  const [selectedLlmId, setSelectedLlmId] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestedCollectionId = searchParams.get("collection_id")?.trim() || "";
  const requestedCollectionName = searchParams.get("collection")?.trim().toLowerCase() || "";

  const candidates = useMemo(
    () => identifyData?.ai?.candidates ?? [],
    [identifyData]
  );

  const selectedCandidate = candidates[selectedIndex];
  const isManualReview = mode === "review" && !identifyData;
  const canSubmitToAi = llmOptions.length > 0;

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => {
      setNotice("");
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    void loadAiSettings();
    void loadAddPreferences({ background: false });
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
    const pendingImageIds = ((identifyData?.stored_images as Array<{ id?: unknown }> | undefined) || [])
      .map((img) => (typeof img.id === "string" ? img.id : ""))
      .filter(Boolean);
    if (pendingImageIds.length > 0) {
      void apiRequest<DiscardImagesResponse>("/api/images/discard", {
        method: "POST",
        body: JSON.stringify({ image_ids: pendingImageIds }),
      }).catch(() => {
        // Best effort cleanup; keep UX responsive if cleanup fails.
      });
    }

    setIdentifyData(null);
    setSelectedIndex(0);
    setDraft({
      name: "",
      description: "",
      collection_id: preferredCollectionId,
      location_id: "",
      status: "draft",
    });
    setSaveError("");
    setSubmitError("");
    setSubmitErrorDetail("");
    setSubmitErrorProvider("");
    setSubmitErrorModel("");
    setShowSubmitErrorDetail(false);
    setSubmitErrorCopied(false);
  }

  async function loadAddPreferences(_opts?: { background?: boolean }) {
    try {
      const [collectionData, locationData, meData] = await Promise.all([
        apiRequest<CollectionOption[]>("/api/collections"),
        apiRequest<LocationOption[]>("/api/locations"),
        apiRequest<MeResponse>("/api/me"),
      ]);

      const collectionOptions = collectionData || [];
      setCollections(collectionOptions);
      setLocations(locationData || []);

      const preferred = meData.preferred_add_collection_id || "";
      const validPreferred = collectionOptions.some((cat) => cat.id === preferred)
        ? preferred
        : "";
      const requestedCollection =
        collectionOptions.find((cat) => cat.id === requestedCollectionId) ??
        collectionOptions.find((cat) => cat.name.trim().toLowerCase() === requestedCollectionName) ??
        null;
      const initialCollectionId = requestedCollection?.id || validPreferred;

      setPreferredCollectionId(initialCollectionId);
      setDraft((current) => ({
        ...current,
        collection_id: current.collection_id || initialCollectionId,
      }));
    } catch (err) {
      setCollections([]);
      setLocations([]);
      setPreferredCollectionId("");
    }
  }

  async function loadAiSettings() {
    try {
      const data = await apiRequest<AiSettingsResponse>("/api/settings/ai");
      const options = data.configs || [];
      setLlmOptions(options);

      const defaultId = data.default_llm_id || options.find((o) => o.is_default)?.id || options[0]?.id || "";
      setSelectedLlmId(defaultId);
    } catch (err) {
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
      collection_id: preferredCollectionId,
      location_id: "",
      status: "draft",
    });
  }

  function startManualReview() {
    setSubmitError("");
    setSubmitErrorDetail("");
    setSubmitErrorProvider("");
    setSubmitErrorModel("");
    setShowSubmitErrorDetail(false);
    setSubmitErrorCopied(false);
    setSaveError("");
    setNotice("");
    clearSession();
    setSelectedIndex(0);
    setDraft((current) => ({
      ...current,
      name: "",
      description: "",
      status: "draft",
    }));
    setMode("review");
  }

  async function persistPreferredCollection(collectionId: string) {
    try {
      await apiRequest("/api/me", {
        method: "PATCH",
        body: JSON.stringify({
          preferred_add_collection_id: collectionId || null,
        }),
      });
      setPreferredCollectionId(collectionId);
    } catch {
      // Keep Add flow usable even if preference persistence fails.
    }
  }

  async function onTakePicture() {
    setSubmitError("");
    setSubmitErrorDetail("");
    setSubmitErrorProvider("");
    setSubmitErrorModel("");
    setShowSubmitErrorDetail(false);
    setSubmitErrorCopied(false);
    const file = await takePicture();
    if (!file) return;
    mergePhotos([file]);
  }

  function onPickPhotos(files: FileList | null) {
    setSubmitError("");
    setSubmitErrorDetail("");
    setSubmitErrorProvider("");
    setSubmitErrorModel("");
    setShowSubmitErrorDetail(false);
    setSubmitErrorCopied(false);
    if (!files) return;
    mergePhotos(Array.from(files));
  }

  async function submitIdentify() {
    setSubmitError("");
    setSubmitErrorDetail("");
    setSubmitErrorProvider("");
    setSubmitErrorModel("");
    setShowSubmitErrorDetail(false);
    setSubmitErrorCopied(false);
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

    if (!canSubmitToAi) {
      setSubmitError("No AI model configured.");
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
      if (draft.collection_id) {
        query.set("collection_id", draft.collection_id);
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
        clearSession();
        setMode("input");
        return;
      }

      const previousImageIds = ((identifyData?.stored_images as Array<{ id?: unknown }> | undefined) || [])
        .map((img) => (typeof img.id === "string" ? img.id : ""))
        .filter(Boolean);
      if (previousImageIds.length > 0) {
        void apiRequest<DiscardImagesResponse>("/api/images/discard", {
          method: "POST",
          body: JSON.stringify({ image_ids: previousImageIds }),
        }).catch(() => {
          // Best effort cleanup; keep identify flow usable if cleanup fails.
        });
      }

      setIdentifyData(data);
      setSelectedIndex(0);
      loadDraftFromCandidate(found[0]);
      setMode("review");
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const detail = (err as Error).message || "Identify failed.";
        const selectedLLM = llmOptions.find((opt) => opt.id === selectedLlmId);
        setSubmitError("Error from AI Model.");
        setSubmitErrorDetail(detail);
        setSubmitErrorProvider(selectedLLM?.provider || "Unknown");
        setSubmitErrorModel(selectedLLM?.model || "Unknown");
        setShowSubmitErrorDetail(false);
        setSubmitErrorCopied(false);
      }
    } finally {
      setIsSubmitting(false);
      setSubmitAbort(null);
    }
  }

  async function savePart() {
    setSaveError("");
    setNotice("");

    let storedImages = identifyData?.stored_images ?? [];
    let pendingStoredImageIds: string[] = [];

    if (!draft.name.trim()) {
      setSaveError("Part name is required.");
      return;
    }

    setIsSaving(true);
    try {
      if (photos.length > 0) {
        const fd = new FormData();
        photos.slice(0, MAX_PHOTOS).forEach((file, idx) => {
          fd.append("images", file, `photo${idx + 1}.jpg`);
        });
        const stored = await apiRequest<StoreImagesResponse>("/api/images/store", {
          method: "POST",
          body: fd,
        });
        storedImages = stored.stored_images ?? [];
        pendingStoredImageIds = storedImages
          .map((img) => ((img as { id?: unknown }).id as string | undefined) || "")
          .filter(Boolean);
      }

      const payload = {
        name: draft.name.trim(),
        description: draft.description,
        collection: collections.find((cat) => cat.id === draft.collection_id)?.name || null,
        status: draft.status,
        ai_primary: identifyData?.ai || selectedCandidate || null,
        ai_alternatives: identifyData && candidates.length > 1 ? { candidates: candidates.slice(1) } : null,
        ai_chosen_index: identifyData && candidates.length > 0 ? selectedIndex : null,
        location_id: draft.location_id || null,
        stored_images: storedImages,
      };

      await apiRequest<{ id: string }>("/api/items", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setPhotos([]);
      clearSession();
      setMode("input");
      setNotice(`Saved ${payload.name}`);

      const main = document.querySelector("main");
      if (main instanceof HTMLElement) {
        main.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (err) {
      if (pendingStoredImageIds.length > 0) {
        void apiRequest<DiscardImagesResponse>("/api/images/discard", {
          method: "POST",
          body: JSON.stringify({ image_ids: pendingStoredImageIds }),
        }).catch(() => {
          // Best effort cleanup after failed save.
        });
      }
      setSaveError((err as Error).message || "Save failed.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <PageHeader
        title="New Item"
        description="Add up to 5 images, submit for AI identification or complete manually"
        action={null}
      />

      {mode === "input" && (
        <section className="space-y-3">
          <PhotoControls
            previewUrls={previewUrls}
            photoCount={photos.length}
            maxPhotos={MAX_PHOTOS}
            disabled={isSubmitting}
            onTakePicture={onTakePicture}
            onPickPhotos={() => fileInputRef.current?.click()}
            onRemovePhoto={removePhoto}
          />

          <div>
            <div className="mb-3">
              <label className="block text-xs uppercase tracking-wide text-neutral-500 mb-1">
                Collection
              </label>
              <select
                value={draft.collection_id}
                onChange={(e) => {
                  const nextCollectionId = e.target.value;
                  setDraft((d) => ({ ...d, collection_id: nextCollectionId }));
                  void persistPreferredCollection(nextCollectionId);
                }}
                className="w-full sm:w-[28rem] bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
              >
                <option value="">None</option>
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
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

            {llmOptions.length === 0 && (
              <p className="mb-3 text-xs text-amber-400">
                No AI model configured. Add one under Settings / AI to enable identification.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={startManualReview}
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-700 rounded-md text-sm text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Manual
              </button>

              <button
                onClick={submitIdentify}
                disabled={!canSubmitToAi || (!isSubmitting && photos.length === 0)}
                className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
              >
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
                {submitAbort ? "Cancel" : "AI Submit"}
              </button>
            </div>
          </div>

          {submitError && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
              <div className="rounded-lg border border-red-500/40 bg-neutral-900 p-6 max-w-md w-full space-y-4">
                <p className="text-sm text-red-300">{submitError}</p>
                {(submitErrorProvider || submitErrorModel) && (
                  <p className="text-xs text-neutral-400">
                    Model: {submitErrorProvider} / {submitErrorModel}
                  </p>
                )}
                {submitErrorDetail && (
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setShowSubmitErrorDetail((current) => !current)}
                      className="text-sm text-red-200 underline underline-offset-2 hover:text-red-100"
                    >
                      {showSubmitErrorDetail ? "Hide info" : "More info"}
                    </button>
                    {showSubmitErrorDetail && (
                      <>
                        <pre className="whitespace-pre-wrap break-words rounded-md bg-black/25 p-3 text-xs text-red-100 max-h-48 overflow-y-auto">
                          {submitErrorDetail}
                        </pre>
                        <button
                          type="button"
                          onClick={() => {
                            const clipboardText = `Model: ${submitErrorProvider} / ${submitErrorModel}\n\n${submitErrorDetail}`;
                            void navigator.clipboard.writeText(clipboardText);
                            setSubmitErrorCopied(true);
                          }}
                          className="text-sm text-red-200 underline underline-offset-2 hover:text-red-100"
                        >
                          {submitErrorCopied ? "Copied" : "Copy to clipboard"}
                        </button>
                      </>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSubmitError("");
                    setSubmitErrorDetail("");
                    setSubmitErrorProvider("");
                    setSubmitErrorModel("");
                    setShowSubmitErrorDetail(false);
                    setSubmitErrorCopied(false);
                  }}
                  className="w-full mt-4 px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-neutral-100 rounded-md text-sm font-medium transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      {mode === "review" && (
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-neutral-200">Review and Edit</h2>
          </div>

          {isManualReview && (
            <PhotoControls
              previewUrls={previewUrls}
              photoCount={photos.length}
              maxPhotos={MAX_PHOTOS}
              disabled={isSaving}
              onTakePicture={onTakePicture}
              onPickPhotos={() => fileInputRef.current?.click()}
              onRemovePhoto={removePhoto}
            />
          )}

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

                <div className="grid sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-neutral-500 mb-1">
                      Collection
                    </label>
                    <select
                      value={draft.collection_id}
                      onChange={(e) => {
                        const nextCollectionId = e.target.value;
                        setDraft((d) => ({ ...d, collection_id: nextCollectionId }));
                        void persistPreferredCollection(nextCollectionId);
                      }}
                      className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                    >
                      <option value="">None</option>
                      {collections.map((collection) => (
                        <option key={collection.id} value={collection.id}>
                          {collection.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs uppercase tracking-wide text-neutral-500 mb-1">
                      Location
                    </label>
                    <select
                      value={draft.location_id}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          location_id: e.target.value,
                        }))
                      }
                      className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                    >
                      <option value="">None</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                        </option>
                      ))}
                    </select>
                  </div>

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
                      clearSession();
                      setSubmitError("");
                      setSubmitErrorDetail("");
                      setSubmitErrorProvider("");
                      setSubmitErrorModel("");
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












