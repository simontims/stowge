import { useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  Loader2,
  Save,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { PageHeader } from "../components/ui/PageHeader";
import { PhotoCapture } from "../components/ui/PhotoCapture";
import { solidActionButtonClasses } from "../components/ui/buttonStyles";
import { apiRequest } from "../lib/api";
import { MIN_NAME_LENGTH, minimumLengthMessage } from "../lib/constraints";
import { buildLocationDisplayLabel } from "../lib/locationHierarchy";
import { resizeImage } from "../lib/resizeImage";
import { useNumericField } from "../hooks/useNumericField";
import { useCurrentUser, useSetCurrentUser } from "../lib/UserContext";
import { type AiHint, type CurrentUser, type LocationOption, type Tag } from "../lib/types";
import { resolveHintId, validTagIds } from "../lib/tags";
import { TagPicker } from "../components/ui/TagPicker";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";

/** How long Add waits after the last change before saving the sticky tags / hint choice. */
const STICKY_SAVE_DELAY_MS = 400;

interface IdentifyCandidate {
  name?: string;
  description?: string;
  evidence?: string;
  confidence?: number;
  unknown?: boolean;
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

interface AddPageBootstrapResponse {
  tags: Tag[];
  hints: AiHint[];
  locations: LocationOption[];
  ai_settings: AiSettingsResponse;
}


interface PartDraft {
  name: string;
  description: string;
  location_id: string;
  status: "draft" | "confirmed";
  quantity: number;
}

type ScanFlowMode = "input" | "review";

const MAX_PHOTOS = 5;

export function AddPage() {
  const currentUser = useCurrentUser();
  const setCurrentUser = useSetCurrentUser();
  // Debounced saves finish after the render that scheduled them; merge into the latest user.
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
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
    location_id: "",
    status: "draft",
    quantity: 1,
  });
  const draftQuantityField = useNumericField(
    draft.quantity,
    (v) => setDraft((d) => ({ ...d, quantity: v })),
    { min: 0, fallback: 0 },
  );
  const [tags, setTags] = useState<Tag[]>([]);
  const [hints, setHints] = useState<AiHint[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  // Session-level persistent context — survives Save / Discard
  const [sessionTagIds, setSessionTagIds] = useState<string[]>([]);
  const [sessionHintId, setSessionHintId] = useState<string>("");
  const [sessionLocationId, setSessionLocationId] = useState<string>("");

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [mode, setMode] = useState<ScanFlowMode>("input");

  const [llmOptions, setLlmOptions] = useState<LlmOption[]>([]);
  const [selectedLlmId, setSelectedLlmId] = useState<string>("");
  const [aiSettingsLoaded, setAiSettingsLoaded] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const requestedTagName = searchParams.get("tag")?.trim().toLowerCase() || "";

  const candidates = useMemo(
    () => identifyData?.ai?.candidates ?? [],
    [identifyData]
  );
  const locationLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const location of locations) {
      labels.set(location.id, buildLocationDisplayLabel(location, locations));
    }
    return labels;
  }, [locations]);

  const selectedCandidate = candidates[selectedIndex];
  const canSubmitToAi = llmOptions.length > 0;

  useEffect(() => {
    void loadAddBootstrapData();
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
    // Reset item-level draft fields but keep session context (tags, hint + location)
    setDraft({
      name: "",
      description: "",
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

  async function loadAddBootstrapData() {
    try {
      const data = await apiRequest<AddPageBootstrapResponse>("/api/items/bootstrap");

      const tagData = data.tags || [];
      const hintData = data.hints || [];
      const locationData = data.locations || [];
      const aiSettings = data.ai_settings || { default_llm_id: null, configs: [] };

      setTags(tagData);
      setHints(hintData);
      setLocations(locationData || []);

      const options = aiSettings.configs || [];
      setLlmOptions(options);

      const defaultId = aiSettings.default_llm_id || options.find((o) => o.is_default)?.id || options[0]?.id || "";
      setSelectedLlmId(defaultId);

      // A tag asked for in the URL (Add Item from a tagged list) wins over the saved tags.
      const requestedTag = requestedTagName
        ? tagData.find((tag) => tag.name.trim().toLowerCase() === requestedTagName)
        : undefined;
      const initialTagIds = requestedTag ? [requestedTag.id] : validTagIds(tagData, currentUser.preferred_add_tag_ids);

      const preferredLocId = currentUser.preferred_add_location_id || "";
      const validLocId = (locationData || []).some((l) => l.id === preferredLocId)
        ? preferredLocId
        : "";

      setSessionTagIds(initialTagIds);
      setSessionHintId(resolveHintId(hintData, currentUser.preferred_add_hint_id));
      setSessionLocationId(validLocId);
      setDraft((current) => ({
        ...current,
        location_id: current.location_id || validLocId,
      }));
    } catch {
      setTags([]);
      setHints([]);
      setLocations([]);
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

  /** Keep UserContext in step with what was saved, so leaving Add and coming back starts from the
   *  latest choices instead of the profile loaded at sign-in. */
  function mergeSavedPreferences(saved: CurrentUser | null | undefined, body: Record<string, unknown>) {
    // Only the keys this request sent: a late answer must not roll other fields back to its older snapshot.
    const fromSaved = saved && saved.id === currentUserRef.current.id ? (saved as unknown as Record<string, unknown>) : {};
    const mine: Record<string, unknown> = {};
    for (const key of Object.keys(body)) mine[key] = key in fromSaved ? fromSaved[key] : body[key];
    const merged = { ...currentUserRef.current, ...mine } as CurrentUser;
    currentUserRef.current = merged; // two saves can finish before the next render
    setCurrentUser(merged);
  }

  async function persistPreferences(body: Record<string, unknown>) {
    try {
      const saved = await apiRequest<CurrentUser>("/api/me", { method: "PATCH", body: JSON.stringify(body) });
      mergeSavedPreferences(saved, body);
    } catch {
      // Keep Add flow usable even if preference persistence fails.
    }
  }

  // Tags and hint are sticky: the last choice is saved (debounced) and is the start point next time.
  const saveStickyTags = useDebouncedCallback((ids: string[]) => {
    void persistPreferences({ preferred_add_tag_ids: ids });
  }, STICKY_SAVE_DELAY_MS);
  const saveStickyHint = useDebouncedCallback((hintId: string) => {
    const isDefault = hints.find((hint) => hint.id === hintId)?.is_default ?? false;
    void persistPreferences({ preferred_add_hint_id: isDefault || !hintId ? null : hintId });
  }, STICKY_SAVE_DELAY_MS);

  async function persistPreferredLocation(locationId: string) {
    try {
      const body = { preferred_add_location_id: locationId || null };
      const saved = await apiRequest<CurrentUser>("/api/me", { method: "PATCH", body: JSON.stringify(body) });
      mergeSavedPreferences(saved, body);
    } catch {
      // Best effort.
    }
  }

  function handleSessionTagsChange(ids: string[]) {
    setSessionTagIds(ids);
    saveStickyTags(ids);
  }

  function handleSessionHintChange(id: string) {
    setSessionHintId(id);
    saveStickyHint(id);
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

  async function handleRotatePhoto(index: number) {
    const { rotateImage } = await import("../lib/rotateImage");
    const rotated = await rotateImage(photos[index]);
    setPhotos((current) => current.map((f, i) => (i === index ? rotated : f)));
  }

  async function submitIdentify() {
    setSubmitError("");
    setSubmitErrorDetail("");
    setSubmitErrorProvider("");
    setSubmitErrorModel("");
    setShowSubmitErrorDetail(false);
    setSubmitErrorCopied(false);
    setSaveError("");

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
      if (sessionHintId) {
        query.set("hint_id", sessionHintId);
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

    let storedImages = identifyData?.stored_images ?? [];
    let pendingStoredImageIds: string[] = [];

    if (draft.name.trim().length < MIN_NAME_LENGTH) {
      setSaveError(minimumLengthMessage("Part name"));
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
        tag_ids: sessionTagIds,
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
      toast.success("Item saved", {
        description: payload.name,
      });

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
      <div className="space-y-2 mb-4">
        <div>
          <label className="block text-xs uppercase tracking-wide text-subtle mb-1">Tags</label>
          <TagPicker tags={tags} selectedIds={sessionTagIds} onChange={handleSessionTagsChange} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="add-hint" className="block text-xs uppercase tracking-wide text-subtle mb-1">AI hint</label>
            <select
              id="add-hint"
              value={sessionHintId}
              onChange={(e) => handleSessionHintChange(e.target.value)}
              className="w-full bg-canvas border border-border-strong rounded-md px-3 py-2 text-sm text-body outline-none focus:border-border-focus"
            >
              {hints.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="add-location" className="block text-xs uppercase tracking-wide text-subtle mb-1">Location</label>
            <select
              id="add-location"
              value={sessionLocationId}
              onChange={(e) => handleSessionLocationChange(e.target.value)}
              className="w-full bg-canvas border border-border-strong rounded-md px-3 py-2 text-sm text-body outline-none focus:border-border-focus"
            >
              <option value="">None</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{locationLabels.get(l.id) || l.name}</option>
              ))}
            </select>
          </div>
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
            onRotatePhoto={handleRotatePhoto}
          />

          {/* Sticky action bar */}
          <div className="sticky bottom-0 -mx-4 px-4 py-3 border-t border-border bg-surface/95 backdrop-blur">
            <div className="flex items-center gap-2">
              <button
                onClick={startManualReview}
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 px-3 py-2 border border-border-strong rounded-md text-sm text-secondary hover:text-heading hover:border-border-hover disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                Continue manually
              </button>
              <button
                onClick={submitIdentify}
                disabled={!canSubmitToAi || (!isSubmitting && photos.length === 0)}
                className={`${solidActionButtonClasses("brand")} flex-1 justify-center px-4 py-2`}
              >
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
                {isSubmitting ? "Identifying…" : "Identify"}
              </button>
            </div>
            {aiSettingsLoaded && llmOptions.length === 0 && (
              <p className="mt-2 text-xs text-warning-400">No AI model configured — identification unavailable. Add one in System / AI.</p>
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
              <label className="block text-xs uppercase tracking-wide text-subtle mb-1">Name</label>
              <input
                autoFocus
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="w-full bg-canvas border border-border-strong rounded-md px-3 py-2 text-sm text-body outline-none focus:border-border-focus"
                placeholder="Item name"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs uppercase tracking-wide text-subtle mb-1">Description</label>
              <textarea
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                className="w-full bg-canvas border border-border-strong rounded-md px-3 py-2 text-sm text-body outline-none focus:border-border-focus"
                placeholder="Optional notes"
              />
            </div>

            {/* Evidence from AI */}
            {selectedCandidate?.evidence && (
              <div className="rounded-md border border-border bg-canvas p-3">
                <p className="text-xs uppercase tracking-wide text-subtle mb-1">AI evidence</p>
                <p className="text-sm text-muted">{selectedCandidate.evidence}</p>
              </div>
            )}

            {/* Metadata grid — Tags, hint and location are in the session strip above */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs uppercase tracking-wide text-subtle mb-1">Status</label>
                <select
                  value={draft.status}
                  onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as "draft" | "confirmed" }))}
                  className="w-full bg-canvas border border-border-strong rounded-md px-3 py-2 text-sm text-body outline-none focus:border-border-focus"
                >
                  <option value="draft">draft</option>
                  <option value="confirmed">confirmed</option>
                </select>
              </div>
              <div>
                <label className="block text-xs uppercase tracking-wide text-subtle mb-1">Quantity</label>
                <input
                  type="number"
                  min={0}
                  {...draftQuantityField}
                  className="w-full bg-canvas border border-border-strong rounded-md px-3 py-2 text-sm text-body outline-none focus:border-border-focus"
                />
              </div>
            </div>

            {saveError && <p className="text-sm text-danger-400">{saveError}</p>}
          </div>

          {/* Sticky review footer */}
          <div className="sticky bottom-0 -mx-4 px-4 py-3 border-t border-border bg-surface/95 backdrop-blur">
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setMode("input"); clearSession(); }}
                className="inline-flex items-center gap-1 px-3 py-2 border border-border-strong rounded-md text-sm text-secondary hover:text-heading hover:border-border-hover transition-colors"
              >
                ← Back
              </button>
              <button
                onClick={resetToStart}
                className="inline-flex items-center px-3 py-2 border border-border-strong rounded-md text-sm text-muted hover:text-heading hover:border-border-hover transition-colors"
              >
                Discard
              </button>
              <button
                onClick={savePart}
                disabled={isSaving}
                className="flex-1 inline-flex items-center justify-center gap-1.5 bg-success-600 hover:bg-success-500 disabled:opacity-60 disabled:cursor-not-allowed text-on-solid px-4 py-2 rounded-md text-sm font-semibold transition-colors"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 p-4">
          <div className="rounded-lg border border-danger-500/40 bg-surface p-6 max-w-md w-full space-y-4">
            <p className="text-sm text-danger-300">{submitError}</p>
            {(submitErrorProvider || submitErrorModel) && (
              <p className="text-xs text-muted">Model: {submitErrorProvider} / {submitErrorModel}</p>
            )}
            {submitErrorDetail && (
              <div className="space-y-3">
                <button type="button" onClick={() => setShowSubmitErrorDetail((v) => !v)} className="text-sm text-danger-200 underline underline-offset-2 hover:text-danger-100">
                  {showSubmitErrorDetail ? "Hide info" : "More info"}
                </button>
                {showSubmitErrorDetail && (
                  <>
                    <pre className="whitespace-pre-wrap break-words rounded-md bg-scrim/25 p-3 text-xs text-danger-100 max-h-48 overflow-y-auto">{submitErrorDetail}</pre>
                    <button type="button" onClick={() => { void navigator.clipboard.writeText(`Model: ${submitErrorProvider} / ${submitErrorModel}\n\n${submitErrorDetail}`); setSubmitErrorCopied(true); }} className="text-sm text-danger-200 underline underline-offset-2 hover:text-danger-100">
                      {submitErrorCopied ? "Copied" : "Copy to clipboard"}
                    </button>
                  </>
                )}
              </div>
            )}
            <button type="button" onClick={() => { setSubmitError(""); setSubmitErrorDetail(""); setSubmitErrorProvider(""); setSubmitErrorModel(""); setShowSubmitErrorDetail(false); setSubmitErrorCopied(false); }} className="w-full mt-4 px-4 py-2 bg-surface-3 hover:bg-surface-4 text-heading rounded-md text-sm font-medium transition-colors">
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








