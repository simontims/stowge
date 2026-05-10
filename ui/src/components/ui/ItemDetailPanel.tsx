import { useEffect, useState } from "react";
import { Save, Trash2, X, ChevronLeft, ChevronRight, Star, Pencil } from "lucide-react";
import { useNumericField } from "../../hooks/useNumericField";
import { useNavigate } from "react-router-dom";
import type { PartDetail, PartEditForm, LocationOption, CollectionOption } from "../../pages/ItemsPage";

interface ItemDetailPanelProps {
  selectedPart: PartDetail | null;
  images: PartDetail["images"];
  editForm: PartEditForm;
  detailLoading: boolean;
  detailError: string;
  savingDetail: boolean;
  deletingPartFromModal: boolean;
  locations: LocationOption[];
  collectionOptions: CollectionOption[];
  hasDirtyChanges: boolean;
  onEditChange: (form: PartEditForm) => void;
  onSave: () => Promise<void>;
  onClose: () => void;
  onConfirmDelete: () => void;
  isMobile?: boolean;
  onSetPrimaryImage?: (imageId: string) => Promise<void>;
}

export function ItemDetailPanel({
  selectedPart,
  images,
  editForm,
  detailLoading,
  detailError,
  savingDetail,
  deletingPartFromModal,
  locations,
  collectionOptions,
  hasDirtyChanges,
  onEditChange,
  onSave,
  onClose,
  onConfirmDelete,
  isMobile = false,
  onSetPrimaryImage,
}: ItemDetailPanelProps) {
  const navigate = useNavigate();
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [settingPrimary, setSettingPrimary] = useState(false);
  const quantityField = useNumericField(
    editForm.quantity,
    (v) => onEditChange({ ...editForm, quantity: v }),
    { min: 0, fallback: 0 },
  );

  // Reset to primary image whenever a different item is selected
  useEffect(() => {
    const primaryIdx = images.findIndex((img) => img.is_primary);
    setActiveImageIdx(primaryIdx >= 0 ? primaryIdx : 0);
  }, [selectedPart?.id, images]);
  return (
    <div
      className={`flex flex-col h-full w-full bg-neutral-950 ${
        isMobile ? "fixed inset-0 z-40" : "relative"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 p-4 flex-none bg-neutral-950">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {isMobile && (
            <button
              onClick={onClose}
              className="inline-flex items-center justify-center p-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-neutral-100 hover:border-neutral-600 flex-shrink-0"
              title="Back to list"
            >
              <ChevronLeft size={14} />
            </button>
          )}
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-neutral-100 truncate">Item Details</h3>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {selectedPart && (
            <button
              onClick={() => navigate(`/items/${selectedPart.id}/edit`)}
              disabled={savingDetail || deletingPartFromModal}
              className="inline-flex items-center justify-center p-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              title="Open full-page edit"
            >
              <Pencil size={14} />
            </button>
          )}
          {selectedPart && (
            <button
              onClick={onConfirmDelete}
              disabled={savingDetail || deletingPartFromModal}
              className="inline-flex items-center justify-center p-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-red-400 hover:border-red-500/60 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
              title="Delete item"
            >
              <Trash2 size={14} />
            </button>
          )}
          {!isMobile && (
            <button
              onClick={onClose}
              className="inline-flex items-center justify-center p-1.5 rounded-md border border-neutral-700 text-neutral-400 hover:text-neutral-100 hover:border-neutral-600 flex-shrink-0"
              title="Close"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {detailLoading && (
        <div className="flex items-center justify-center py-8">
          <p className="text-sm text-neutral-400">Loading part details...</p>
        </div>
      )}

      {!detailLoading && detailError && (
        <div className="p-4">
          <p className="text-sm text-red-400">{detailError}</p>
        </div>
      )}

      {!detailLoading && selectedPart && (
        <div className="flex flex-col min-h-full">
          <div className="flex-1 p-4 space-y-4">
            {images.length > 0 && (
              <div className="relative group h-64 rounded-md border border-neutral-800 overflow-hidden bg-neutral-900">
                <img
                  src={images[activeImageIdx]?.display_url}
                  alt={selectedPart.name}
                  className="w-full h-full object-cover"
                />
                {images.length > 1 && (
                  <>
                    {images[activeImageIdx]?.is_primary ? (
                      <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/90 text-white text-xs font-medium pointer-events-none">
                        <Star size={10} fill="currentColor" />
                        Primary
                      </div>
                    ) : (
                      <button
                        onClick={async () => {
                          const imgId = images[activeImageIdx]?.id;
                          if (!imgId || !onSetPrimaryImage || settingPrimary) return;
                          setSettingPrimary(true);
                          try {
                            await onSetPrimaryImage(imgId);
                          } finally {
                            setSettingPrimary(false);
                          }
                        }}
                        disabled={settingPrimary}
                        className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-xs font-medium hover:bg-black/80 disabled:opacity-60 transition-colors"
                      >
                        <Star size={10} />
                        {settingPrimary ? "Setting…" : "Make primary"}
                      </button>
                    )}
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
            )}

            <div className="space-y-3">
              <label className="space-y-1 block">
                <span className="text-xs text-neutral-500 uppercase tracking-wide">Name</span>
                <input
                  value={editForm.name}
                  onChange={(event) =>
                    onEditChange({ ...editForm, name: event.target.value })
                  }
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                  placeholder="Part name"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1 block">
                  <span className="text-xs text-neutral-500 uppercase tracking-wide">Collection</span>
                  <select
                    value={editForm.collection}
                    onChange={(event) =>
                      onEditChange({ ...editForm, collection: event.target.value })
                    }
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                  >
                    <option value="">No collection</option>
                    {collectionOptions.map((collection) => (
                      <option key={collection.id} value={collection.name}>
                        {collection.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 block">
                  <span className="text-xs text-neutral-500 uppercase tracking-wide">Location</span>
                  <select
                    value={editForm.location_id}
                    onChange={(event) =>
                      onEditChange({
                        ...editForm,
                        location_id: event.target.value,
                      })
                    }
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                  >
                    <option value="">No location</option>
                    {locations.map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 block">
                  <span className="text-xs text-neutral-500 uppercase tracking-wide">Status</span>
                  <select
                    value={editForm.status}
                    onChange={(event) =>
                      onEditChange({
                        ...editForm,
                        status: event.target.value === "confirmed" ? "confirmed" : "draft",
                      })
                    }
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
                    {...quantityField}
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                  />
                </label>
              </div>

              <label className="space-y-1 block">
                <span className="text-xs text-neutral-500 uppercase tracking-wide">Description</span>
                <textarea
                  value={editForm.description}
                  onChange={(event) =>
                    onEditChange({ ...editForm, description: event.target.value })
                  }
                  rows={4}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-600"
                  placeholder="Optional notes"
                />
              </label>

            </div>
          </div>

          {/* Footer Actions - Sticky */}
          <div className="border-t border-neutral-800 p-4 bg-neutral-950 sticky bottom-0">
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded-md border border-neutral-500 bg-neutral-800 text-neutral-100 hover:bg-neutral-700 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={onSave}
                disabled={!hasDirtyChanges || savingDetail}
                className={[
                  "flex-1 inline-flex items-center justify-center gap-1 px-3 py-2.5 rounded-md border transition-colors disabled:opacity-60 text-sm font-semibold",
                  hasDirtyChanges
                    ? "border-emerald-500 bg-emerald-600 text-white hover:bg-emerald-500"
                    : "border-neutral-700 bg-neutral-900 text-neutral-500",
                ].join(" ")}
              >
                <Save size={14} />
                {savingDetail ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
