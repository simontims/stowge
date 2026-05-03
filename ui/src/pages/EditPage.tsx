import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Brain,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Plus,
  Save,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { apiRequest } from "../lib/api";
import { MIN_NAME_LENGTH, minimumLengthMessage } from "../lib/constraints";
import { useBeforeUnload } from "../lib/useBeforeUnload";

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

interface PartDetail {
  id: string;
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
}

interface LocationOption {
  id: string;
  name: string;
}

interface CollectionOption {
  id: string;
  name: string;
}

interface EditForm {
  name: string;
  description: string;
  collection: string;
  location_id: string;
  status: "draft" | "confirmed";
  quantity: number;
}

interface AiCandidate {
  name?: string;
  description?: string;
  collection?: string;
  confidence?: number;
  unknown?: boolean;
  evidence?: string;
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
  };
}

function isSameForm(a: EditForm, b: EditForm): boolean {
  return (
    a.name.trim() === b.name.trim() &&
    a.description.trim() === b.description.trim() &&
    a.collection.trim() === b.collection.trim() &&
    a.location_id === b.location_id &&
    a.status === b.status &&
    a.quantity === b.quantity
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
  onAccept: () => void;
  onDismiss: () => void;
}

function DiffPanel({ current, candidates, selectedIdx, onSelectIdx, onAccept, onDismiss }: DiffPanelProps) {
  const candidate = candidates[selectedIdx];
  if (!candidate) return null;

  const fields: Array<{ label: string; currentVal: string; proposedVal: string }> = [
    { label: "Name", currentVal: current.name, proposedVal: candidate.name ?? "" },
    { label: "Description", currentVal: current.description, proposedVal: candidate.description ?? "" },
    { label: "Collection", currentVal: current.collection, proposedVal: candidate.collection ?? "" },
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
                  <div className="text-neutral-500 text-[10px] uppercase tracking-wide mb-1">Proposed</div>
                  <div className={`break-words ${changed ? "text-amber-200" : "text-neutral-400"}`}>
                    {f.proposedVal || <span className="italic text-neutral-600">empty</span>}
                  </div>
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
        onClick={onAccept}
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
  const navigate = useNavigate();

  const [part, setPart] = useState<PartDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [form, setForm] = useState<EditForm>({ name: "", description: "", collection: "", location_id: "", status: "draft", quantity: 1 });
  const [initialForm, setInitialForm] = useState<EditForm>({ name: "", description: "", collection: "", location_id: "", status: "draft", quantity: 1 });

  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [collectionOptions, setCollectionOptions] = useState<CollectionOption[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const [deleting, setDeleting] = useState(false);
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);

  // Image state
  const [images, setImages] = useState<PartImage[]>([]);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [imageError, setImageError] = useState("");
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI rescan state
  const [rescanning, setRescanning] = useState(false);
  const [rescanError, setRescanError] = useState("");
  const [candidates, setCandidates] = useState<AiCandidate[]>([]);
  const [selectedCandidateIdx, setSelectedCandidateIdx] = useState(0);
  const [showDiff, setShowDiff] = useState(false);

  const hasDirtyChanges = part !== null && !isSameForm(form, initialForm);
  useBeforeUnload(hasDirtyChanges);

  // Load on mount
  useEffect(() => {
    if (!itemId) return;
    void loadAll(itemId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  async function loadAll(id: string) {
    setLoading(true);
    setLoadError("");
    try {
      const [partData, locs, colls] = await Promise.all([
        apiRequest<PartDetail>(`/api/items/${id}`),
        apiRequest<LocationOption[]>("/api/locations"),
        apiRequest<CollectionOption[]>("/api/collections"),
      ]);
      setPart(partData);
      setImages(partData.images);
      const mapped = toEditForm(partData);
      setForm(mapped);
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
    if (trimmedName.length < MIN_NAME_LENGTH) {
      setSaveError(minimumLengthMessage("Name"));
      return false;
    }
    setSaving(true);
    setSaveError("");
    try {
      await apiRequest(`/api/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: trimmedName,
          description: form.description.trim() || null,
          collection: form.collection.trim() || null,
          location_id: form.location_id || null,
          status: form.status,
          quantity: form.quantity,
        }),
      });
      const refreshed = await apiRequest<PartDetail>(`/api/items/${itemId}`);
      const refreshedForm = toEditForm(refreshed);
      setPart(refreshed);
      setImages(refreshed.images);
      setForm(refreshedForm);
      setInitialForm(refreshedForm);
      navigate(-1);
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
    navigate(-1);
  }

  function handleUnsavedDiscard() {
    setUnsavedPromptOpen(false);
    navigate(-1);
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
      await apiRequest(`/api/images/${imageId}`, { method: "DELETE" });
      setImages((prev) => {
        const updated = prev.filter((img) => img.id !== imageId);
        // If we removed the active image, clamp index
        setActiveImageIdx((idx) => Math.min(idx, Math.max(0, updated.length - 1)));
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
      await apiRequest(`/api/images/${imageId}/set-primary`, { method: "POST" });
      setImages((prev) => prev.map((img) => ({ ...img, is_primary: img.id === imageId })));
    } catch (err) {
      setImageError((err as Error).message || "Failed to set primary.");
    } finally {
      setSettingPrimaryId(null);
    }
  }

  async function handleImageUpload(files: FileList | null) {
    if (!files || files.length === 0 || !itemId) return;
    setUploadingImages(true);
    setImageError("");
    try {
      const fd = new FormData();
      Array.from(files).slice(0, 5).forEach((f, idx) => {
        fd.append("images", f, f.name || `photo${idx + 1}`);
      });
      const result = await apiRequest<{ images: PartImage[] }>(`/api/items/${itemId}/images`, {
        method: "POST",
        body: fd,
      });
      setImages((prev) => [...prev, ...(result.images ?? [])]);
    } catch (err) {
      setImageError((err as Error).message || "Failed to upload images.");
    } finally {
      setUploadingImages(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRescan() {
    if (!itemId) return;
    setRescanning(true);
    setRescanError("");
    setCandidates([]);
    setShowDiff(false);
    try {
      const result = await apiRequest<{ mode: string; ai: { candidates?: AiCandidate[] } | AiCandidate }>(`/api/items/${itemId}/rescan`, {
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
      setCandidates(found);
      setSelectedCandidateIdx(0);
      setShowDiff(true);
    } catch (err) {
      setRescanError((err as Error).message || "Re-scan failed.");
    } finally {
      setRescanning(false);
    }
  }

  function handleApplyCandidate() {
    const candidate = candidates[selectedCandidateIdx];
    if (!candidate) return;
    setForm((prev) => ({
      ...prev,
      name: candidate.name?.trim() ? candidate.name.trim() : prev.name,
      description: candidate.description?.trim() ? candidate.description.trim() : prev.description,
      collection: candidate.collection?.trim() ? candidate.collection.trim() : prev.collection,
    }));
    setShowDiff(false);
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
    <div className="flex flex-col h-full max-w-2xl mx-auto w-full">
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
              <div className="relative group h-64 rounded-md border border-neutral-800 overflow-hidden bg-neutral-900">
                <img
                  src={images[activeImageIdx]?.display_url}
                  alt={part.name}
                  className="w-full h-full object-cover"
                />

                {/* Primary badge / button */}
                {images[activeImageIdx]?.is_primary ? (
                  <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/90 text-white text-xs font-medium pointer-events-none">
                    <Star size={10} fill="currentColor" />
                    Primary
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      const id = images[activeImageIdx]?.id;
                      if (id && !settingPrimaryId) void handleSetPrimary(id);
                    }}
                    disabled={!!settingPrimaryId}
                    className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-xs font-medium hover:bg-black/80 disabled:opacity-60 transition-colors"
                  >
                    <Star size={10} />
                    {settingPrimaryId === images[activeImageIdx]?.id ? "Setting…" : "Make primary"}
                  </button>
                )}

                {/* Delete image button */}
                <button
                  onClick={() => {
                    const id = images[activeImageIdx]?.id;
                    if (id && !deletingImageId) void handleDeleteImage(id);
                  }}
                  disabled={!!deletingImageId}
                  className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-xs font-medium hover:bg-red-600/80 disabled:opacity-60 transition-colors opacity-0 group-hover:opacity-100"
                  title="Remove this image"
                >
                  <Trash2 size={10} />
                  {deletingImageId === images[activeImageIdx]?.id ? "Removing…" : "Remove"}
                </button>

                {/* Prev/next arrows */}
                {images.length > 1 && (
                  <>
                    <button
                      onClick={() => setActiveImageIdx((i) => (i - 1 + images.length) % images.length)}
                      className="absolute left-1.5 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                      aria-label="Previous image"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <button
                      onClick={() => setActiveImageIdx((i) => (i + 1) % images.length)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70"
                      aria-label="Next image"
                    >
                      <ChevronRight size={18} />
                    </button>

                    {/* Dots */}
                    <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
                      {images.map((_, idx) => (
                        <button
                          key={idx}
                          onClick={() => setActiveImageIdx(idx)}
                          className={[
                            "w-1.5 h-1.5 rounded-full transition-colors",
                            idx === activeImageIdx ? "bg-white" : "bg-white/40 hover:bg-white/70",
                          ].join(" ")}
                          aria-label={`Image ${idx + 1}`}
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="h-40 rounded-md border border-dashed border-neutral-700 flex items-center justify-center text-sm text-neutral-500">
                No images
              </div>
            )}

            {imageError && <p className="text-xs text-red-400">{imageError}</p>}

            {/* Add images */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void handleImageUpload(e.target.files)}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImages}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-700 bg-neutral-900 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-50 text-sm transition-colors"
              >
                {uploadingImages ? (
                  <><Loader2 size={13} className="animate-spin" /> Uploading…</>
                ) : (
                  <><Plus size={13} /> Add images</>
                )}
              </button>
            </div>
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
                  min={1}
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: Math.max(1, parseInt(e.target.value) || 1) }))}
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

            <div className="text-xs text-neutral-600 space-y-0.5 pt-1">
              <div>ID: {part.id}</div>
              <div>Created: {new Date(part.created_at).toLocaleString()}</div>
              <div>Updated: {new Date(part.updated_at).toLocaleString()}</div>
            </div>
          </section>

          {/* ---- AI Rescan section ---- */}
          <section className="space-y-3">
            <h2 className="text-xs text-neutral-500 uppercase tracking-wide font-medium">AI</h2>

            {!showDiff && (
              <div className="space-y-2">
                <button
                  onClick={() => void handleRescan()}
                  disabled={rescanning || images.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-neutral-700 bg-neutral-900 text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-50 text-sm transition-colors"
                  title={images.length === 0 ? "Item needs images to re-scan" : "Re-scan with AI using current saved images"}
                >
                  {rescanning ? (
                    <><Loader2 size={13} className="animate-spin" /> Scanning…</>
                  ) : (
                    <><Brain size={13} /> Re-scan with AI</>
                  )}
                </button>
                {images.length === 0 && (
                  <p className="text-xs text-neutral-600">Add images first to re-scan.</p>
                )}
                {rescanError && <p className="text-xs text-red-400">{rescanError}</p>}
              </div>
            )}

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
            {saving ? "Saving…" : "Save changes"}
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
    </div>
  );
}
