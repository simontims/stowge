import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  Camera,
  Loader2,
  Save,
  Upload,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { apiRequest } from "../lib/api";
import { useCurrentUser } from "../lib/UserContext";

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
  ai_max_edge: number;
  ai_quality: number;
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

interface PartDraft {
  name: string;
  description: string;
  collection_id: string;
  location_id: string;
  status: "draft" | "confirmed";
  quantity: number;
}

type ScanFlowMode = "input" | "review";

const MAX_PHOTOS = 5;

// ---------------------------------------------------------------------------
// PhotoCapture — fixed-position button + thumbnail strip below
// ---------------------------------------------------------------------------
interface PhotoCaptureProps {
  previewUrls: string[];
  photoCount: number;
  maxPhotos: number;
  disabled: boolean;
  hideButtons?: boolean;
  onTakePicture: () => void;
  onPickPhotos: () => void;
  onRemovePhoto: (index: number) => void;
}

function PhotoCapture({
  previewUrls,
  photoCount,
  maxPhotos,
  disabled,
  hideButtons = false,
  onTakePicture,
  onPickPhotos,
  onRemovePhoto,
}: PhotoCaptureProps) {
  const atMax = photoCount >= maxPhotos;
  return (
    <div className="space-y-3">
      {/* Button row — hidden in review mode but keeps same space for thumbnails */}
      {!hideButtons && (
        <div className="flex items-center gap-2">
          <button
            onClick={onTakePicture}
            disabled={disabled || atMax}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 border border-neutral-700 rounded-md text-sm text-neutral-200 hover:text-white hover:border-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Camera size={16} />
            Take photo
          </button>
          <button
            onClick={onPickPhotos}
            disabled={disabled || atMax}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-3 border border-neutral-700 rounded-md text-sm text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            aria-label="Upload photos"
          >
            <Upload size={16} />
          </button>
          <span className="text-xs text-neutral-600 w-8 text-right shrink-0">{photoCount}/{maxPhotos}</span>
        </div>
      )}

      {/* Thumbnail strip */}
      {previewUrls.length > 0 && (
        <div className="flex gap-2">
          {previewUrls.map((url, idx) => (
            <div key={url} className="relative w-14 h-14 shrink-0 rounded border border-neutral-700 overflow-hidden bg-neutral-900">
              <img src={url} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
              {!hideButtons && (
                <button
                  onClick={() => onRemovePhoto(idx)}
                  disabled={disabled}
                  className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black/90 disabled:opacity-60"
                  aria-label={`Remove photo ${idx + 1}`}
                >
                  <X size={8} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AddPage() {
  const currentUser = useCurrentUser();
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
    quantity: 1,
  });
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  // Session-level persistent context — survives Save / Discard
  const [sessionCollectionId, setSessionCollectionId] = useState<string>("");
  const [sessionLocationId, setSessionLocationId] = useState<string>("");

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState<string>("");
  const [mode, setMode] = useState<ScanFlowMode>("input");

  const [llmOptions, setLlmOptions] = useState<LlmOption[]>([]);
  const [selectedLlmId, setSelectedLlmId] = useState<string>("");
  const [aiSettingsLoaded, setAiSettingsLoaded] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const requestedCollectionId = searchParams.get("collection_id")?.trim() || "";
  const requestedCollectionName = searchParams.get("collection")?.trim().toLowerCase() || "";

  const candidates = useMemo(
    () => identifyData?.ai?.candidates ?? [],
    [identifyData]
  );

  const selectedCandidate = candidates[selectedIndex];
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
      }).catch(() => {});
    }

    setIdentifyData(null);
    setSelectedIndex(0);
    // Reset item-level draft fields but keep session context (collection + location)
    setDraft({
      name: "",
      description: "",
      collection_id: sessionCollectionId,
      location_id: sessionLocationId,
      status: "draft",
      quantity: 1,
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
      const [collectionData, locationData] = await Promise.all([
        apiRequest<CollectionOption[]>("/api/collections"),
        apiRequest<LocationOption[]>("/api/locations"),
      ]);

      const collectionOptions = collectionData || [];
      setCollections(collectionOptions);
      setLocations(locationData || []);

      const preferred = currentUser.preferred_add_collection_id || "";
      const validPreferred = collectionOptions.some((cat) => cat.id === preferred)
        ? preferred
        : "";
      const requestedCollection =
        collectionOptions.find((cat) => cat.id === requestedCollectionId) ??
        collectionOptions.find((cat) => cat.name.trim().toLowerCase() === requestedCollectionName) ??
        null;
      const initialCollectionId = requestedCollection?.id || validPreferred;

      const preferredLocId = currentUser.preferred_add_location_id || "";
      const validLocId = (locationData || []).some((l) => l.id === preferredLocId)
        ? preferredLocId
        : "";

      setSessionCollectionId(initialCollectionId);
      setSessionLocationId(validLocId);
      setDraft((current) => ({
        ...current,
        collection_id: current.collection_id || initialCollectionId,
        location_id: current.location_id || validLocId,
      }));
    } catch {
      setCollections([]);
      setLocations([]);
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
    } finally {
      setAiSettingsLoaded(true);
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
      collection_id: sessionCollectionId,
      location_id: sessionLocationId,
      status: "draft",
      quantity: 1,
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
      quantity: 1,
    }));
    setMode("review");
  }

  async function persistPreferredCollection(collectionId: string) {
    try {
      await apiRequest("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ preferred_add_collection_id: collectionId || null }),
      });
    } catch {
      // Keep Add flow usable even if preference persistence fails.
    }
  }

  async function persistPreferredLocation(locationId: string) {
    try {
      await apiRequest("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ preferred_add_location_id: locationId || null }),
      });
    } catch {
      // Best effort.
    }
  }

  function handleSessionCollectionChange(id: string) {
    setSessionCollectionId(id);
    setDraft((d) => ({ ...d, collection_id: id }));
    void persistPreferredCollection(id);
  }

  function handleSessionLocationChange(id: string) {
    setSessionLocationId(id);
    setDraft((d) => ({ ...d, location_id: id }));
    void persistPreferredLocation(id);
  }

  function onTakePicture() {
    setSubmitError("");
    setSubmitErrorDetail("");
    setSubmitErrorProvider("");
    setSubmitErrorModel("");
    setShowSubmitErrorDetail(false);
    setSubmitErrorCopied(false);
    cameraInputRef.current?.click();
  }

  function handleCameraCapture(files: FileList | null) {
    if (!files || files.length === 0) return;
    mergePhotos([files[0]]);
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
      const selectedLlm = llmOptions.find((opt) => opt.id === selectedLlmId);
      const maxEdge = selectedLlm?.ai_max_edge ?? 1600;
      const quality = Math.max(1, Math.min(100, selectedLlm?.ai_quality ?? 85)) / 100;

      const toUpload = await Promise.all(
        photos.slice(0, MAX_PHOTOS).map((photo) => resizeImage(photo, maxEdge, quality))
      );
      const fd = new FormData();
      toUpload.forEach((file, idx) => {
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
        // Upload originals for storage so server-side image settings remain authoritative.
        const toUpload = photos.slice(0, MAX_PHOTOS);
        const fd = new FormData();
        toUpload.forEach((file, idx) => {
          fd.append("images", file, file.name || `photo${idx + 1}`);
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
        quantity: draft.quantity,
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
      setNotice(`Saved "${payload.name}"`);

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
    <div className="flex flex-col pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <PageHeader title="Add item" action={null} />

      {/* ── SESSION STRIP ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div>
          <label className="block text-xs uppercase tracking-wide text-neutral-500 mb-1">Collection</label>
          <select
            value={sessionCollectionId}
            onChange={(e) => handleSessionCollectionChange(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
          >
            <option value="">None</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wide text-neutral-500 mb-1">Location</label>
          <select
            value={sessionLocationId}
            onChange={(e) => handleSessionLocationChange(e.target.value)}
            className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
          >
            <option value="">None</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── MODE: INPUT ───────────────────────────────────────────────────── */}
      {mode === "input" && (
        <div className="space-y-4">
          <PhotoCapture
            previewUrls={previewUrls}
            photoCount={photos.length}
            maxPhotos={MAX_PHOTOS}
            disabled={isSubmitting}
            onTakePicture={onTakePicture}
            onPickPhotos={() => fileInputRef.current?.click()}
            onRemovePhoto={removePhoto}
          />

          {notice && <p className="text-sm text-emerald-400">{notice}</p>}

          {/* Sticky action bar */}
          <div className="sticky bottom-0 -mx-4 px-4 py-3 border-t border-neutral-800 bg-neutral-900/95 backdrop-blur">
            <div className="flex items-center gap-2">
              <button
                onClick={startManualReview}
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 px-3 py-2 border border-neutral-700 rounded-md text-sm text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                Continue manually
              </button>
              <button
                onClick={submitIdentify}
                disabled={!canSubmitToAi || (!isSubmitting && photos.length === 0)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
              >
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
                {isSubmitting ? "Identifying…" : "Identify"}
              </button>
            </div>
            {aiSettingsLoaded && llmOptions.length === 0 && (
              <p className="mt-2 text-xs text-amber-400">No AI model configured — identification unavailable. Add one in System / AI.</p>
            )}
          </div>
        </div>
      )}

      {/* ── MODE: REVIEW ──────────────────────────────────────────────────── */}
      {mode === "review" && (
        <div className="space-y-4">
          {/* Same thumbnail strip as input mode — no layout jump */}
          <PhotoCapture
            previewUrls={previewUrls}
            photoCount={photos.length}
            maxPhotos={MAX_PHOTOS}
            disabled={false}
            hideButtons
            onTakePicture={() => {}}
            onPickPhotos={() => {}}
            onRemovePhoto={() => {}}
          />

          <div className="space-y-3">
            {/* Name */}
            <div>
              <label className="block text-xs uppercase tracking-wide text-neutral-500 mb-1">Name</label>
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                placeholder="Item name"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs uppercase tracking-wide text-neutral-500 mb-1">Description</label>
              <textarea
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                placeholder="Optional notes"
              />
            </div>

            {/* Evidence from AI */}
            {selectedCandidate?.evidence && (
              <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                <p className="text-xs uppercase tracking-wide text-neutral-500 mb-1">AI evidence</p>
                <p className="text-sm text-neutral-400">{selectedCandidate.evidence}</p>
              </div>
            )}

            {/* Metadata grid — Collection/Location are in the session strip above */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs uppercase tracking-wide text-neutral-500 mb-1">Status</label>
                <select
                  value={draft.status}
                  onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as "draft" | "confirmed" }))}
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                >
                  <option value="draft">draft</option>
                  <option value="confirmed">confirmed</option>
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide text-neutral-500 mb-1">Quantity</label>
                <input
                  type="number"
                  min={1}
                  value={draft.quantity}
                  onChange={(e) => setDraft((d) => ({ ...d, quantity: Math.max(1, parseInt(e.target.value) || 1) }))}
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                />
              </div>
            </div>

            {saveError && <p className="text-sm text-red-400">{saveError}</p>}
          </div>

          {/* Sticky review footer */}
          <div className="sticky bottom-0 -mx-4 px-4 py-3 border-t border-neutral-800 bg-neutral-900/95 backdrop-blur">
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setMode("input"); clearSession(); }}
                className="inline-flex items-center gap-1 px-3 py-2 border border-neutral-700 rounded-md text-sm text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={resetToStart}
                className="inline-flex items-center px-3 py-2 border border-neutral-700 rounded-md text-sm text-neutral-400 hover:text-neutral-100 hover:border-neutral-600 transition-colors"
              >
                Discard
              </button>
              <button
                onClick={savePart}
                disabled={isSaving}
                className="flex-1 inline-flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-4 py-2 rounded-md text-sm font-semibold transition-colors"
              >
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI error modal */}
      {submitError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="rounded-lg border border-red-500/40 bg-neutral-900 p-6 max-w-md w-full space-y-4">
            <p className="text-sm text-red-300">{submitError}</p>
            {(submitErrorProvider || submitErrorModel) && (
              <p className="text-xs text-neutral-400">Model: {submitErrorProvider} / {submitErrorModel}</p>
            )}
            {submitErrorDetail && (
              <div className="space-y-3">
                <button type="button" onClick={() => setShowSubmitErrorDetail((v) => !v)} className="text-sm text-red-200 underline underline-offset-2 hover:text-red-100">
                  {showSubmitErrorDetail ? "Hide info" : "More info"}
                </button>
                {showSubmitErrorDetail && (
                  <>
                    <pre className="whitespace-pre-wrap break-words rounded-md bg-black/25 p-3 text-xs text-red-100 max-h-48 overflow-y-auto">{submitErrorDetail}</pre>
                    <button type="button" onClick={() => { void navigator.clipboard.writeText(`Model: ${submitErrorProvider} / ${submitErrorModel}\n\n${submitErrorDetail}`); setSubmitErrorCopied(true); }} className="text-sm text-red-200 underline underline-offset-2 hover:text-red-100">
                      {submitErrorCopied ? "Copied" : "Copy to clipboard"}
                    </button>
                  </>
                )}
              </div>
            )}
            <button type="button" onClick={() => { setSubmitError(""); setSubmitErrorDetail(""); setSubmitErrorProvider(""); setSubmitErrorModel(""); setShowSubmitErrorDetail(false); setSubmitErrorCopied(false); }} className="w-full mt-4 px-4 py-2 bg-neutral-700 hover:bg-neutral-600 text-neutral-100 rounded-md text-sm font-medium transition-colors">
              Close
            </button>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => { onPickPhotos(e.target.files); e.currentTarget.value = ""; }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { void handleCameraCapture(e.target.files); e.currentTarget.value = ""; }}
      />
    </div>
  );
}

// AI identify upload pre-resize. Storage uploads are intentionally not pre-resized.
function resizeImage(file: File, maxEdge: number, quality: number): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const { naturalWidth: w, naturalHeight: h } = img;
      const safeMaxEdge = Math.max(64, Math.min(4096, maxEdge || 1600));
      const safeQuality = Math.max(0.01, Math.min(1, quality || 0.85));
      const scale = Math.min(1, safeMaxEdge / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }));
        },
        "image/jpeg",
        safeQuality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });
}












