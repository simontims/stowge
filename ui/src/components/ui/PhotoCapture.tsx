import { Camera, RotateCw, Upload, X } from "lucide-react";

interface PhotoCaptureProps {
  previewUrls: string[];
  photoCount: number;
  maxPhotos: number;
  disabled: boolean;
  hideButtons?: boolean;
  onTakePicture: () => void;
  onPickPhotos: () => void;
  onRemovePhoto: (index: number) => void;
  onRotatePhoto?: (index: number) => void;
}

export function PhotoCapture({
  previewUrls,
  photoCount,
  maxPhotos,
  disabled,
  hideButtons = false,
  onTakePicture,
  onPickPhotos,
  onRemovePhoto,
  onRotatePhoto,
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
              {!hideButtons && onRotatePhoto && (
                <button
                  onClick={() => onRotatePhoto(idx)}
                  disabled={disabled}
                  className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center hover:bg-black/90 disabled:opacity-60"
                  aria-label={`Rotate photo ${idx + 1}`}
                >
                  <RotateCw size={8} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
