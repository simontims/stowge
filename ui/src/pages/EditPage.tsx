import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Brain,
  Camera,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  RotateCw,
  Save,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { solidActionButtonClasses } from "../components/ui/buttonStyles";
import { apiRequest } from "../lib/api";
import { MIN_NAME_LENGTH, minimumLengthMessage } from "../lib/constraints";
import { useBeforeUnload } from "../lib/useBeforeUnload";
import { useNumericField } from "../hooks/useNumericField";
import { type LocationOption, type CollectionOption } from "../lib/types";
import { imageStateSignature } from "../lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PartImage {
  id: string;
  thumb_url: string;
  display_url: string;
  original_url: string | null;
  is_primary: boolean;
}

interface DraftImage extends PartImage {
  is_local?: boolean;
  local_file?: File;
  rotation?: number; // 0, 90, 180, 270
}

interface ContentsEntry {
  id: string;
  name: string;
  quantity: number;
  note: string | null;
}

interface PartDetail {
  id: string;
  is_deleted: boolean;
  name: string;
  description: string | null;
  collection: string | null;
  location_id: string | null;
  location: string | null;
  status: string;
  quantity: number;
  created_at: string;
  updated_at: string;
  images: PartImage[];
  contents: ContentsEntry[];
}


interface EditForm {
  name: string;
  description: string;
  collection: string;
  location_id: string;
  status: "draft" | "confirmed";
  quantity: number;
  contents: ContentsEntry[];
}

interface AiCandidate {
  name?: string;
  description?: string;
  confidence?: number;
  unknown?: boolean;
  evidence?: string;
}

interface AiProposedValues {
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toEditForm(part: PartDetail): EditForm {
  return {
    name: part.name ?? "",
    description: part.description ?? "",
    collection: part.collection ?? "",
    location_id: part.location_id ?? "",
    status: part.status === "confirmed" ? "confirmed" : "draft",
    quantity: part.quantity ?? 1,
    contents: (part.contents ?? []).map((entry) => ({
      id: entry.id,
      name: (entry.name || "").trim(),
      quantity: Math.max(1, Number.isFinite(entry.quantity) ? entry.quantity : 1),
      note: entry.note ?? null,
    })),
  };
}

function isSameForm(a: EditForm, b: EditForm): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    a.description.trim() === b.description.trim() &&
    a.collection.trim() === b.collection.trim() &&
    a.location_id === b.location_id &&
    a.status === b.status &&
    a.quantity === b.quantity &&
    JSON.stringify(a.contents) === JSON.stringify(b.contents)
  );
}

function createLocalContentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `local-${crypto.randomUUID()}`;
  }
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}


interface ContentQuantityFieldProps {
  value: number;
  onCommit: (value: number) => void;
}

function ContentQuantityField({ value, onCommit }: ContentQuantityFieldProps) {
  const field = useNumericField(value, onCommit, { min: 1, fallback: 1 });
  return (
    <input
      type="number"
      min={1}
      {...field}
      className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-600"
    />
  );
}

// ---------------------------------------------------------------------------
// AI Diff Panel
// ---------------------------------------------------------------------------
interface DiffPanelProps {
  current: EditForm;
  candidates: AiCandidate[];
  selectedIdx: number;
  onSelectIdx: (idx: number) => void;
  onAccept: (proposed: AiProposedValues) => void;
  onDismiss: () => void;
}

function DiffPanel({ current, candidates, selectedIdx, onSelectIdx, onAccept, onDismiss }: DiffPanelProps) {
  const candidate = candidates[selectedIdx];
  if (!candidate) return null;

  const [proposed, setProposed] = useState<AiProposedValues>({
    name: candidate.name ?? "",
    description: candidate.description ?? "",
  });

  useEffect(() => {
    setProposed({
      name: candidate.name ?? "",
      description: candidate.description ?? "",
    });
  }, [candidate]);

  const fields: Array<{ key: keyof AiProposedValues; label: string; currentVal: string; proposedVal: string }> = [
    { key: "name", label: "Name", currentVal: current.name, proposedVal: proposed.name },
    { key: "description", label: "Description", currentVal: current.description, proposedVal: proposed.description },
  ];

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-950/20 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={15} className="text-amber-400" />
          <span className="text-sm font-semibold text-amber-300">AI Suggestions</span>
        </div>
        <button
          onClick={onDismiss}
          className="p-1 rounded text-neutral-500 hover:text-neutral-300"
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>

      {/* Candidate selector tabs */}
      {candidates.length > 1 && (
        <div className="flex gap-1 flex-wrap">
          {candidates.map((c, i) => (
            <button
              key={i}
              onClick={() => onSelectIdx(i)}
              className={[
                "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                i === selectedIdx
                  ? "border-amber-500/70 bg-amber-900/40 text-amber-200"
                  : "border-neutral-700 bg-neutral-900 text-neutral-400 hover:text-neutral-200",
              ].join(" ")}
            >
              Option {i + 1}
              {c.confidence !== undefined && (
                <span className="ml-1 opacity-60">{Math.round((c.confidence ?? 0) * 100)}%</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Side-by-side diff */}
      <div className="space-y-3">
        {fields.map((f) => {
          const changed = f.currentVal.trim() !== f.proposedVal.trim() && f.proposedVal.trim() !== "";
          return (
            <div key={f.label}>
              <div className="text-xs text-neutral-500 uppercase tracking-wide mb-1">{f.label}</div>
              <div className="grid grid-cols-2 gap-2">
                <div className={`rounded p-2 text-xs ${changed ? "bg-neutral-900 border border-neutral-700" : "bg-neutral-900/50 border border-neutral-800"}`}>
                  <div className="text-neutral-500 text-[10px] uppercase tracking-wide mb-1">Current</div>
                  <div className="text-neutral-300 break-words">{f.currentVal || <span className="italic text-neutral-600">empty</span>}</div>
                </div>
                <div className={`rounded p-2 text-xs ${changed ? "bg-amber-950/40 border border-amber-500/40" : "bg-neutral-900/50 border border-neutral-800"}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="text-neutral-500 text-[10px] uppercase tracking-wide">Proposed</div>
                    <button
                      onClick={() => setProposed((prev) => ({ ...prev, [f.key]: f.currentVal }))}
                      className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600"
                      title={`Revert ${f.label.toLowerCase()} to current value`}
                    >
                      Revert
                    </button>
                  </div>
                  {f.key === "description" ? (
                    <textarea
                      value={f.proposedVal}
                      onChange={(event) => setProposed((prev) => ({ ...prev, description: event.target.value }))}
                      rows={3}
                      className={`w-full rounded border px-2 py-1.5 text-xs focus:outline-none focus:ring-1 resize-y ${changed ? "border-amber-500/50 bg-amber-900/20 text-amber-100 focus:ring-amber-600" : "border-neutral-700 bg-neutral-900 text-neutral-300 focus:ring-neutral-600"}`}
                      placeholder="Proposed description"
                    />
                  ) : (
                    <input
                      value={f.proposedVal}
                      onChange={(event) =>
                        setProposed((prev) => ({
                          ...prev,
                          [f.key]: event.target.value,
                        }))
                      }
                      className={`w-full rounded border px-2 py-1.5 text-xs focus:outline-none focus:ring-1 ${changed ? "border-amber-500/50 bg-amber-900/20 text-amber-100 focus:ring-amber-600" : "border-neutral-700 bg-neutral-900 text-neutral-300 focus:ring-neutral-600"}`}
                      placeholder={`Proposed ${f.label.toLowerCase()}`}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {candidate.evidence && (
          <div className="text-xs text-neutral-500 italic border-t border-neutral-800 pt-2">
            <span className="font-medium text-neutral-600">Evidence: </span>{candidate.evidence}
          </div>
        )}
      </div>

      <button
        onClick={() => onAccept(proposed)}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border border-amber-500/70 bg-amber-600/20 text-amber-200 hover:bg-amber-600/30 text-sm font-medium transition-colors"
      >
        Apply selected suggestion to form
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main EditPage
// ---------------------------------------------------------------------------
export function EditPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const restoreOnSave = Boolean((location.state as { restoreOnSave?: boolean } | null)?.restoreOnSave);
  const returnToRecycleBin = Boolean((location.state as { returnToRecycleBin?: boolean } | null)?.returnToRecycleBin);

  function navigateAfterEditExit() {
    if (returnToRecycleBin) {
      navigate("/collections", { state: { openRecycleBin: true } });
      return;
    }
    navigate(-1);
  }

  const [part, setPart] = useState<PartDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [form, setForm] = useState<EditForm>({ name: "", description: "", collection: "", location_id: "", status: "draft", quantity: 1, contents: [] });
  const [initialForm, setInitialForm] = useState<EditForm>({ name: "", description: "", collection: "", location_id: "", status: "draft", quantity: 1, contents: [] });
  const formQuantityField = useNumericField(
    form.quantity,
    (v) => setForm((f) => ({ ...f, quantity: v })),
    { min: 0, fallback: 0 },
  );

  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [collectionOptions, setCollectionOptions] = useState<CollectionOption[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [deleting, setDeleting] = useState(false);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [editingContentIdx, setEditingContentIdx] = useState<number | null>(null);
  const [contentDraft, setContentDraft] = useState<{ name: string; quantity: number; note: string }>({
    name: "",
    quantity: 1,
    note: "",
  });

  // Image state
  const [images, setImages] = useState<DraftImage[]>([]);
  const [initialImages, setInitialImages] = useState<PartImage[]>([]);
  const [initialImageSignature, setInitialImageSignature] = useState("");
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [imageError, setImageError] = useState("");
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const localImageUrlsRef = useRef<Set<string>>(new Set());

  // AI rescan state
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState("");
  const [candidates, setCandidates] = useState<AiCandidate[]>([]);
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState(0);
  const [showDiff, setShowDiff] = useState(false);
  const restoreActionButtonRef = useRef<HTMLButtonElement | null>(null);

  function goPrevImage() {
    if (images.length <= 1) return;
    setActiveImageIdx((i) => (i - 1 + images.length) % images.length);
  }

  function goNextImage() {
    if (images.length <= 1) return;
    setActiveImageIdx((i) => (i + 1) % images.length);
  }

  const hasFormDirtyChanges = part !== null && !isSameForm(form, initialForm);
  const hasImageDirtyChanges = part !== null && imageStateSignature(images) !== initialImageSignature;
  const hasPendingRestore = part !== null && part.is_deleted && restoreOnSave;
  const hasDirtyChanges = hasFormDirtyChanges || hasImageDirtyChanges || hasPendingRestore;
  const primaryActionLabel = hasPendingRestore ? "Restore" : "Save changes";
  useBeforeUnload(hasDirtyChanges);

  // Load on mount
  useEffect(() => {
    if (!itemId) return;
    void loadAll(itemId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, restoreOnSave]);

  useEffect(() => {
    return () => {
      for (const url of localImageUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      localImageUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!lightboxOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setLightboxOpen(false);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevImage();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNextImage();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxOpen, images.length]);

  useEffect(() => {
    if (!hasPendingRestore || loading || saving || unsavedPromptOpen || lightboxOpen) return;
    requestAnimationFrame(() => {
      restoreActionButtonRef.current?.focus();
    });
  }, [hasPendingRestore, loading, saving, unsavedPromptOpen, lightboxOpen, part?.id]);

  async function loadAll(id: string) {
    setLoading(true);
    setLoadError("");
    try {
      const [partData, locs, colls] = await Promise.all([
        apiRequest<PartDetail>(`/api/items/${id}${restoreOnSave ? "?include_deleted=true" : ""}`),
        apiRequest<LocationOption[]>("/api/locations"),
        apiRequest<CollectionOption[]>("/api/collections"),
      ]);
      setPart(partData);
      setImages(partData.images);
      setInitialImages(partData.images);
      setInitialImageSignature(imageStateSignature(partData.images));
      const mapped = toEditForm(partData);
      const normalized = { ...mapped };

      if (restoreOnSave && partData.is_deleted) {
        const hasCollection = normalized.collection && colls.some((c) => c.name === normalized.collection);
        const hasLocation = normalized.location_id && locs.some((l) => l.id === normalized.location_id);

        if (!hasCollection) {
          normalized.collection = "";
        }
        if (!hasLocation) {
          normalized.location_id = "";
        }
      }

      setForm(normalized);
      setInitialForm(mapped);
      setLocations(locs || []);
      setCollectionOptions(colls || []);

      const primaryIdx = partData.images.findIndex((img) => img.is_primary);
      setActiveImageIdx(primaryIdx >= 0 ? primaryIdx : 0);
    } catch (err) {
      setLoadError((err as Error).message || "Failed to load item.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(): Promise<boolean> {
    if (!itemId || !hasDirtyChanges) return true;

    const trimmedName = form.name.trim();
    if (hasFormDirtyChanges && trimmedName.length < MIN_NAME_LENGTH) {
      setSaveError(minimumLengthMessage("Name"));
      return false;
    }

    setSaving(true);
    setSaveError("");
    try {
      if (hasPendingRestore) {
        await apiRequest(`/api/items/${itemId}/restore`, { method: "POST" });
      }

      if (hasFormDirtyChanges) {
        const normalizedContents = form.contents.map((entry) => ({
          name: entry.name.trim(),
          quantity: Math.max(1, Number.isFinite(entry.quantity) ? entry.quantity : 1),
          note: (entry.note || "").trim() || null,
        }));
        await apiRequest(`/api/items/${itemId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: trimmedName,
            description: form.description.trim() || null,
            collection: form.collection.trim() || null,
            location_id: form.location_id || null,
            status: form.status,
            quantity: form.quantity,
            contents: normalizedContents,
          }),
        });
      }

      if (hasImageDirtyChanges) {
        // Apply pending rotations to persisted images
        const rotatedPersistedImages = images.filter((img) => !img.is_local && img.rotation);
        for (const img of rotatedPersistedImages) {
          await apiRequest(`/api/images/${img.id}/rotate?direction=cw&degrees=${img.rotation}`, {
            method: "POST",
          });
        }

        // Apply pending rotations to local images (rotate the File blob)
        const localImagesWithRotation = images.filter(
          (img) => img.is_local && img.local_file && img.rotation
        );
        if (localImagesWithRotation.length > 0) {
          const { rotateImage } = await import("../lib/rotateImage");
          for (const img of localImagesWithRotation) {
            let file = img.local_file!;
            const steps = (img.rotation! / 90);
            for (let s = 0; s < steps; s++) {
              file = await rotateImage(file);
            }
            // Mutate the draft in-place for the upload step below
            (img as DraftImage).local_file = file;
          }
        }

        const removedImageIds = initialImages
          .filter((img) => !images.some((current) => !current.is_local && current.id === img.id))
          .map((img) => img.id);

        const localImages = images.filter((img): img is DraftImage & { is_local: true; local_file: File } =>
          img.is_local === true && !!img.local_file
        );

        const localIdToPersistedId = new Map<string, string>();

        for (let index = 0; index < localImages.length; index += 5) {
          const chunk = localImages.slice(index, index + 5);
          const fd = new FormData();
          chunk.forEach((img, chunkIdx) => {
            fd.append("images", img.local_file, img.local_file.name || `photo${chunkIdx + 1}`);
          });

          const uploadResult = await apiRequest<{ images: PartImage[] }>(`/api/items/${itemId}/images`, {
            method: "POST",
            body: fd,
          });

          const uploaded = uploadResult.images ?? [];
          chunk.forEach((img, chunkIdx) => {
            const persisted = uploaded[chunkIdx];
            if (persisted) {
              localIdToPersistedId.set(img.id, persisted.id);
            }
          });
        }

        for (const imageId of removedImageIds) {
          await apiRequest(`/api/images/${imageId}`, { method: "DELETE" });
        }

        const desiredPrimaryDraftId = images.find((img) => img.is_primary)?.id;
        const desiredPrimaryId = desiredPrimaryDraftId
          ? (localIdToPersistedId.get(desiredPrimaryDraftId) || desiredPrimaryDraftId)
          : null;

        let refreshedAfterImageOps = await apiRequest<PartDetail>(`/api/items/${itemId}`);

        if (desiredPrimaryId) {
          const currentPrimaryId = refreshedAfterImageOps.images.find((img) => img.is_primary)?.id;
          const primaryExists = refreshedAfterImageOps.images.some((img) => img.id === desiredPrimaryId);
          if (primaryExists && currentPrimaryId !== desiredPrimaryId) {
            await apiRequest(`/api/images/${desiredPrimaryId}/set-primary`, { method: "POST" });
            refreshedAfterImageOps = await apiRequest<PartDetail>(`/api/items/${itemId}`);
          }
        }

        for (const url of localImageUrlsRef.current) {
          URL.revokeObjectURL(url);
        }
        localImageUrlsRef.current.clear();

        const refreshedForm = toEditForm(refreshedAfterImageOps);
        setPart(refreshedAfterImageOps);
        setImages(refreshedAfterImageOps.images);
        setInitialImages(refreshedAfterImageOps.images);
        setInitialImageSignature(imageStateSignature(refreshedAfterImageOps.images));
        setForm(refreshedForm);
        setInitialForm(refreshedForm);
        navigateAfterEditExit();
        return true;
      }

      const refreshed = await apiRequest<PartDetail>(`/api/items/${itemId}`);
      const refreshedForm = toEditForm(refreshed);
      setPart(refreshed);
      setImages(refreshed.images);
      setInitialImages(refreshed.images);
      setInitialImageSignature(imageStateSignature(refreshed.images));
      setForm(refreshedForm);
      setInitialForm(refreshedForm);
      navigateAfterEditExit();
      return true;
    } catch (err) {
      setSaveError((err as Error).message || "Failed to save.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!itemId) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/items/${itemId}`, { method: "DELETE" });
      // Navigate back and pass the deleted item info in state for toast display
      navigate("/items", { state: { deletedItemId: itemId, deletedItemName: part?.name ?? "Item" } });
    } catch (err) {
      setSaveError((err as Error).message || "Failed to delete item.");
    } finally {
      setDeleting(false);
    }
  }

  function requestBackNavigation() {
    if (hasDirtyChanges) {
      setUnsavedPromptOpen(true);
      return;
    }
    navigateAfterEditExit();
  }

  function handleUnsavedDiscard() {
    setUnsavedPromptOpen(false);
    navigateAfterEditExit();
  }

  function handleUnsavedCancel() {
    setUnsavedPromptOpen(false);
  }

  async function handleUnsavedSave() {
    const ok = await handleSave();
    if (ok) {
      setUnsavedPromptOpen(false);
    }
  }

  async function handleDeleteImage(imageId: string) {
    setDeletingImageId(imageId);
    setImageError("");
    try {
      const localImg = images.find((img) => img.id === imageId);
      if (localImg?.is_local) {
        localImageUrlsRef.current.delete(localImg.display_url);
        URL.revokeObjectURL(localImg.display_url);
      }

      setImages((prev) => {
        let updated = prev.filter((img) => img.id !== imageId);

        if (updated.length > 0 && !updated.some((img) => img.is_primary)) {
          updated = updated.map((img, idx) => ({ ...img, is_primary: idx === 0 }));
        }

        if (updated.length === 0) {
          setActiveImageIdx(0);
          setLightboxOpen(false);
          return updated;
        }
        // If we removed the active image, clamp index.
        setActiveImageIdx((idx) => Math.min(idx, updated.length - 1));
        return updated;
      });
    } catch (err) {
      setImageError((err as Error).message || "Failed to delete image.");
    } finally {
      setDeletingImageId(null);
    }
  }

  async function handleSetPrimary(imageId: string) {
    setSettingPrimaryId(imageId);
    try {
      setImages((prev) => prev.map((img) => ({ ...img, is_primary: img.id === imageId })));
    } catch (err) {
      setImageError((err as Error).message || "Failed to set primary.");
    } finally {
      setSettingPrimaryId(null);
    }
  }

  async function handleImageUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingImages(true);
    setImageError("");
    try {
      const selectedFiles = Array.from(files).slice(0, 5);
      setImages((prev) => {
        const hasPrimary = prev.some((img) => img.is_primary);
        const added: DraftImage[] = selectedFiles.map((file, idx) => {
          const objectUrl = URL.createObjectURL(file);
          localImageUrlsRef.current.add(objectUrl);
          return {
            id: `local-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`,
            thumb_url: objectUrl,
            display_url: objectUrl,
            original_url: null,
            is_primary: false,
            is_local: true,
            local_file: file,
          };
        });

        if (!hasPrimary && added.length > 0) {
          added[0].is_primary = true;
        }

        return [...prev, ...added];
      });
    } catch (err) {
      setImageError((err as Error).message || "Failed to add images.");
    } finally {
      setUploadingImages(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleRotateImage(imageId: string) {
    setImages((prev) =>
      prev.map((i) =>
        i.id === imageId
          ? { ...i, rotation: ((i.rotation || 0) + 90) % 360 }
          : i
      )
    );
  }

  async function handleRescan() {
    if (!itemId) return;
    setRescanning(true);
    setRescanError("");
    setCandidates([]);
    setShowDiff(false);
    try {
      const query = new URLSearchParams({ mode: "one" });
      if (restoreOnSave) query.set("include_deleted", "true");
      const result = await apiRequest<{ mode: string; ai: { candidates?: AiCandidate[] } | AiCandidate }>(`/api/items/${itemId}/rescan?${query.toString()}`, {
        method: "POST",
      });
      // mode=three returns { candidates: [...] }, mode=one returns candidate directly
      let found: AiCandidate[] = [];
      const ai = result.ai;
      if (ai && typeof ai === "object" && "candidates" in ai && Array.isArray(ai.candidates)) {
        found = ai.candidates;
      } else if (ai && typeof ai === "object") {
        found = [ai as AiCandidate];
      }
      if (found.length === 0) {
        setRescanError("No suggestions returned. Try again.");
        return;
      }
      setCandidates(found.slice(0, 1));
      setSelectedCandidateIdx(0);
      setShowDiff(true);
    } catch (err) {
      setRescanError((err as Error).message || "Scan failed.");
    } finally {
      setRescanning(false);
    }
  }

  function handleApplyCandidate(proposed: AiProposedValues) {
    setForm((prev) => ({
      ...prev,
      name: proposed.name.trim() ? proposed.name.trim() : prev.name,
      description: proposed.description,
    }));
    setShowDiff(false);
  }

  function startEditContent(index: number) {
    const entry = form.contents[index];
    if (!entry) return;
    setEditingContentIdx(index);
    setContentDraft({
      name: entry.name,
      quantity: Math.max(1, entry.quantity || 1),
      note: entry.note || "",
    });
  }

  function cancelEditContent() {
    if (editingContentIdx !== null) {
      setForm((current) => {
        const entry = current.contents[editingContentIdx];
        if (!entry) return current;
        const isPlaceholder = !entry.name.trim() && !(entry.note || "").trim() && (entry.quantity || 1) === 1;
        if (!isPlaceholder) return current;
        return {
          ...current,
          contents: current.contents.filter((_, idx) => idx !== editingContentIdx),
        };
      });
    }
    setEditingContentIdx(null);
    setContentDraft({ name: "", quantity: 1, note: "" });
  }

  function saveContentEdit(index: number) {
    const name = contentDraft.name.trim();
    if (!name) return;
    const quantity = Math.max(1, contentDraft.quantity || 1);
    const note = contentDraft.note.trim() || null;
    setForm((current) => ({
      ...current,
      contents: current.contents.map((entry, idx) =>
        idx === index
          ? {
              ...entry,
              name,
              quantity,
              note,
            }
          : entry
      ),
    }));
    cancelEditContent();
  }

  function addContentRow() {
    const localId = createLocalContentId();
    const nextIndex = form.contents.length;
    setForm((current) => ({
      ...current,
      contents: [
        ...current.contents,
        {
          id: localId,
          name: "",
          quantity: 1,
          note: null,
        },
      ],
    }));
    setEditingContentIdx(nextIndex);
    setContentDraft({ name: "", quantity: 1, note: "" });
  }

  function deleteContentRow(index: number) {
    // TODO: Offer a future "promote to full item" action from this row.
    setForm((current) => ({
      ...current,
      contents: current.contents.filter((_, idx) => idx !== index),
    }));
    if (editingContentIdx === index) {
      cancelEditContent();
    } else if (editingContentIdx !== null && editingContentIdx > index) {
      setEditingContentIdx(editingContentIdx - 1);
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={24} className="text-neutral-500 animate-spin" />
      </div>
    );
  }

  if (loadError || !part) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-red-400">{loadError || "Item not found."}</p>
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-neutral-400 hover:text-neutral-200 underline"
        >
          Go back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full pb-[calc(1rem+env(safe-area-inset-bottom))]">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-neutral-800 flex-none">
        <button
          onClick={requestBackNavigation}
          className="inline-flex items-center justify-center p-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-neutral-100 hover:border-neutral-600 flex-shrink-0"
          title="Back"
        >
          <ArrowLeft size={14} />
        </button>
        <h1 className="text-base font-semibold text-neutral-100 truncate flex-1">Edit Item</h1>
        <button
          onClick={() => void handleDelete()}
          disabled={deleting}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-red-400 hover:border-red-500/60 disabled:opacity-40 text-xs transition-colors"
          title="Delete item"
        >
          <Trash2 size={13} />
          {deleting ? "Deleting..." : "Delete"}
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-6">

          {/* ---- Images section ---- */}
          <section className="space-y-3">
            <h2 className="text-xs text-neutral-500 uppercase tracking-wide font-medium">Images</h2>

            {images.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {images.map((img, idx) => (
                  <div
                    key={img.id}
                    className="relative group rounded-md border border-neutral-800 overflow-hidden bg-neutral-900"
                  >
                    <button
                      onClick={() => {
                        setActiveImageIdx(idx);
                        setLightboxOpen(true);
                      }}
                      className="block w-full aspect-square"
                      title="View full size"
                    >
                      <img
                        src={img.thumb_url || img.display_url}
                        alt={`${part.name} ${idx + 1}`}
                        className="w-full h-full object-cover"
                        style={img.rotation ? { transform: `rotate(${img.rotation}deg)` } : undefined}
                      />
                    </button>

                    {img.is_primary ? (
                      <div className="absolute top-1.5 left-1.5 flex items-center gap-1 px-2 py-1 rounded bg-amber-500/90 text-white text-xs font-medium pointer-events-none">
                        <Star size={12} fill="currentColor" />
                        Primary
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (!settingPrimaryId) void handleSetPrimary(img.id);
                        }}
                        disabled={!!settingPrimaryId}
                        className="absolute top-1.5 left-1.5 flex items-center gap-1 px-2 py-1 rounded bg-black/60 text-white text-xs font-medium hover:bg-black/80 disabled:opacity-60 transition-colors"
                      >
                        <Star size={12} />
                        {settingPrimaryId === img.id ? "Setting…" : "Make primary"}
                      </button>
                    )}

                    <button
                      onClick={() => {
                        if (!deletingImageId) void handleDeleteImage(img.id);
                      }}
                      disabled={!!deletingImageId}
                      className="absolute top-1.5 right-1.5 flex items-center gap-1 px-2 py-1 rounded bg-black/60 text-white text-xs font-medium hover:bg-red-600/80 disabled:opacity-60 transition-colors opacity-0 group-hover:opacity-100"
                      title="Remove this image"
                    >
                      <Trash2 size={12} />
                      {deletingImageId === img.id ? "Removing…" : "Remove"}
                    </button>

                    <button
                      onClick={() => handleRotateImage(img.id)}
                      className="absolute bottom-1.5 right-1.5 flex items-center gap-1 px-2 py-1 rounded bg-black/60 text-white text-xs font-medium hover:bg-black/80 transition-colors opacity-0 group-hover:opacity-100"
                      title="Rotate 90° clockwise"
                    >
                      <RotateCw size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-40 rounded-md border border-dashed border-neutral-700 flex items-center justify-center text-sm text-neutral-500">
                No images
              </div>
            )}

            {imageError && <p className="text-xs text-red-400">{imageError}</p>}

            {/* Add images + AI rescan */}
            <div className="flex items-center gap-2 flex-wrap">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void handleImageUpload(e.target.files)}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  void handleImageUpload(e.target.files);
                  e.currentTarget.value = "";
                }}
              />
              <button
                onClick={() => cameraInputRef.current?.click()}
                disabled={uploadingImages}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-700 bg-neutral-900 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-50 text-sm transition-colors"
              >
                <Camera size={13} /> Take photo
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImages}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-700 bg-neutral-900 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-50 text-sm transition-colors"
              >
                {uploadingImages ? (
                  <><Loader2 size={13} className="animate-spin" /> Adding…</>
                ) : (
                  <><Plus size={13} /> Add images</>
                )}
              </button>

              <button
                onClick={() => void handleRescan()}
                disabled={rescanning || images.length === 0}
                className={`${solidActionButtonClasses("brand")} px-3 py-1.5`}
                title={images.length === 0 ? "Item needs images to scan" : "Scan with AI using current saved images"}
              >
                {rescanning ? (
                  <><Loader2 size={13} className="animate-spin" /> Identifying…</>
                ) : (
                  <><Brain size={13} /> Scan with AI</>
                )}
              </button>
            </div>

            {images.length === 0 && (
              <p className="text-xs text-neutral-600">Add images first to scan.</p>
            )}
            {rescanError && <p className="text-xs text-red-400">{rescanError}</p>}

            {showDiff && candidates.length > 0 && (
              <DiffPanel
                current={form}
                candidates={candidates}
                selectedIdx={selectedCandidateIdx}
                onSelectIdx={setSelectedCandidateIdx}
                onAccept={handleApplyCandidate}
                onDismiss={() => setShowDiff(false)}
              />
            )}
          </section>

          {/* ---- Fields section ---- */}
          <section className="space-y-3">
            <h2 className="text-xs text-neutral-500 uppercase tracking-wide font-medium">Details</h2>

            <label className="space-y-1 block">
              <span className="text-xs text-neutral-500 uppercase tracking-wide">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                placeholder="Item name"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1 block">
                <span className="text-xs text-neutral-500 uppercase tracking-wide">Collection</span>
                <select
                  value={form.collection}
                  onChange={(e) => setForm((f) => ({ ...f, collection: e.target.value }))}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                >
                  <option value="">No collection</option>
                  {collectionOptions.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 block">
                <span className="text-xs text-neutral-500 uppercase tracking-wide">Location</span>
                <select
                  value={form.location_id}
                  onChange={(e) => setForm((f) => ({ ...f, location_id: e.target.value }))}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                >
                  <option value="">No location</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 block">
                <span className="text-xs text-neutral-500 uppercase tracking-wide">Status</span>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value === "confirmed" ? "confirmed" : "draft" }))}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                >
                  <option value="draft">draft</option>
                  <option value="confirmed">confirmed</option>
                </select>
              </label>

              <label className="space-y-1 block">
                <span className="text-xs text-neutral-500 uppercase tracking-wide">Quantity</span>
                <input
                  type="number"
                  min={0}
                  {...formQuantityField}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                />
              </label>
            </div>

            <label className="space-y-1 block">
              <span className="text-xs text-neutral-500 uppercase tracking-wide">Description</span>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={4}
                className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                placeholder="Optional notes"
              />
            </label>

            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-neutral-500 uppercase tracking-wide">Contents</span>
                <button
                  type="button"
                  onClick={addContentRow}
                  className="inline-flex items-center gap-1 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-600 hover:text-neutral-100"
                >
                  <Plus size={12} />
                  Add row
                </button>
              </div>

              {form.contents.length === 0 ? (
                <div className="rounded-md border border-dashed border-neutral-700 bg-neutral-900/40 px-3 py-2 text-xs text-neutral-500">
                  No contents yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {form.contents.map((entry, index) => {
                    const isEditing = editingContentIdx === index;
                    return (
                      <div key={`${entry.id || "entry"}-${index}`} className="rounded-md border border-neutral-800 bg-neutral-900/70 p-2.5">
                        {isEditing ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_6rem] gap-2">
                              <input
                                value={contentDraft.name}
                                onChange={(e) => setContentDraft((prev) => ({ ...prev, name: e.target.value }))}
                                className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                                placeholder="Name"
                              />
                              <ContentQuantityField
                                value={contentDraft.quantity}
                                onCommit={(quantity) => setContentDraft((prev) => ({ ...prev, quantity }))}
                              />
                            </div>
                            <input
                              value={contentDraft.note}
                              onChange={(e) => setContentDraft((prev) => ({ ...prev, note: e.target.value }))}
                              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                              placeholder="Optional note"
                            />
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={cancelEditContent}
                                className="inline-flex items-center gap-1 rounded-md border border-neutral-700 px-2.5 py-1.5 text-xs text-neutral-300 hover:border-neutral-600 hover:text-neutral-100"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => saveContentEdit(index)}
                                disabled={!contentDraft.name.trim()}
                                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/70 bg-emerald-950/30 px-2.5 py-1.5 text-xs text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-neutral-100 break-words">{entry.name}</div>
                                {entry.note ? (
                                  <div className="mt-0.5 text-xs text-neutral-400 break-words">{entry.note}</div>
                                ) : null}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className="inline-flex items-center rounded border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-xs text-neutral-300">
                                  qty {Math.max(1, entry.quantity || 1)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => startEditContent(index)}
                                  className="rounded-md border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:border-neutral-600 hover:text-neutral-100"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteContentRow(index)}
                                  className="rounded-md border border-red-500/50 px-2 py-0.5 text-xs text-red-300 hover:border-red-400 hover:text-red-200"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="text-xs text-neutral-600 space-y-0.5 pt-1">
              <div>ID: {part.id}</div>
              <div>Created: {new Date(part.created_at).toLocaleString()}</div>
              <div>Updated: {new Date(part.updated_at).toLocaleString()}</div>
            </div>
          </section>

          {saveError && (
            <p className="text-sm text-red-400 px-1">{saveError}</p>
          )}
        </div>
      </div>

      {/* Sticky footer */}
      <div className="border-t border-neutral-800 p-4 bg-neutral-950 flex-none">
        <div className="flex items-center gap-2">
          <button
            onClick={requestBackNavigation}
            className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded-md border border-neutral-700 bg-neutral-800 text-neutral-300 hover:text-neutral-100 hover:bg-neutral-700 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            ref={restoreActionButtonRef}
            onClick={() => void handleSave()}
            disabled={!hasDirtyChanges || saving}
            className={[
              "flex-1 inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded-md border transition-colors disabled:opacity-60 text-sm font-semibold",
              hasDirtyChanges
                ? "border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-500"
                : "border-neutral-700 bg-neutral-900 text-neutral-500",
            ].join(" ")}
          >
            <Save size={14} />
            {saving ? (hasPendingRestore ? "Restoring…" : "Saving…") : primaryActionLabel}
          </button>
        </div>
      </div>

      {unsavedPromptOpen && (
        <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4">
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl p-4 space-y-3"
          >
            <h3 className="text-sm font-semibold text-neutral-100">Unsaved Changes</h3>
            <p className="text-sm text-neutral-300">
              You have unsaved changes. Save before leaving this page?
            </p>
            <div className="pt-1 flex items-center justify-end gap-2">
              <button
                onClick={handleUnsavedCancel}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-neutral-700 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleUnsavedDiscard}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-500/70 text-red-300 bg-red-950/30 hover:text-red-200 hover:bg-red-900/30 disabled:opacity-60 text-sm"
              >
                Discard
              </button>
              <button
                onClick={() => void handleUnsavedSave()}
                disabled={saving}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-500/70 bg-emerald-950/30 text-emerald-300 hover:text-emerald-200 disabled:opacity-60 text-sm"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {lightboxOpen && images.length > 0 && images[activeImageIdx] && (
        <div className="fixed inset-0 z-[80] bg-black/90 p-2 sm:p-4 flex items-center justify-center">
          <div className="relative w-full h-full max-w-6xl max-h-[92vh] rounded-lg border border-neutral-800 bg-black overflow-hidden group">
            <img
              src={images[activeImageIdx].display_url || images[activeImageIdx].original_url || images[activeImageIdx].thumb_url}
              alt={`${part.name} full view`}
              className="w-full h-full object-contain"
              style={images[activeImageIdx].rotation ? { transform: `rotate(${images[activeImageIdx].rotation}deg)` } : undefined}
            />

            {images[activeImageIdx].is_primary ? (
              <div className="absolute top-3 left-3 flex items-center gap-1 px-2 py-1 rounded bg-amber-500/90 text-white text-xs font-medium pointer-events-none">
                <Star size={11} fill="currentColor" />
                Primary
              </div>
            ) : (
              <button
                onClick={() => {
                  const id = images[activeImageIdx]?.id;
                  if (id && !settingPrimaryId) void handleSetPrimary(id);
                }}
                disabled={!!settingPrimaryId}
                className="absolute top-3 left-3 flex items-center gap-1 px-2 py-1 rounded bg-black/60 text-white text-xs font-medium hover:bg-black/80 disabled:opacity-60 transition-colors"
              >
                <Star size={11} />
                {settingPrimaryId === images[activeImageIdx].id ? "Setting…" : "Make primary"}
              </button>
            )}

            <div className="absolute top-3 right-3 flex items-center gap-2">
              <button
                onClick={() => {
                  const id = images[activeImageIdx]?.id;
                  if (id && !deletingImageId) void handleDeleteImage(id);
                }}
                disabled={!!deletingImageId}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-black/60 text-white text-xs font-medium hover:bg-red-600/80 disabled:opacity-60 transition-colors"
                title="Remove this image"
              >
                <Trash2 size={11} />
                {deletingImageId === images[activeImageIdx].id ? "Removing…" : "Remove"}
              </button>
              <button
                onClick={() => setLightboxOpen(false)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-black/60 text-white text-xs font-medium hover:bg-black/80 transition-colors"
                title="Close"
              >
                <X size={11} />
                Close
              </button>
            </div>

            {images.length > 1 && (
              <>
                <button
                  onClick={goPrevImage}
                  className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
                  aria-label="Previous image"
                >
                  <ChevronLeft size={20} />
                </button>
                <button
                  onClick={goNextImage}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white transition-colors hover:bg-black/70"
                  aria-label="Next image"
                >
                  <ChevronRight size={20} />
                </button>
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-2 py-1 rounded bg-black/60 text-white text-xs">
                  {activeImageIdx + 1} / {images.length}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
