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

interface IdentifyCandidate {
  name?: string;
  description?: string;
  evidence?: string;
  confidence?: number;
  unknown?: boolean;
  category?: string;
}

interface IdentifyResponse {
  ai?: {
    candidates?: IdentifyCandidate[];
  };
  stored_images?: Array<Record<string, unknown>>;
}

interface PartDraft {
  name: string;
  description: string;
  category: string;
  status: "draft" | "confirmed";
}

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
    category: "",
    status: "draft",
  });

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const candidates = useMemo(
    () => identifyData?.ai?.candidates ?? [],
    [identifyData]
  );

  const selectedCandidate = candidates[selectedIndex];

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
    setDraft({ name: "", description: "", category: "", status: "draft" });
    setSaveError("");
  }

  function loadDraftFromCandidate(candidate: IdentifyCandidate | undefined) {
    setDraft({
      name: candidate?.name || "Unknown part",
      description: candidate?.description || "",
      category: candidate?.category || (candidate?.unknown ? "unknown" : ""),
      status: "draft",
    });
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

    if (photos.length < 1) {
      setSubmitError("Add at least one photo.");
      return;
    }

    if (submitAbort) {
      submitAbort.abort();
      setSubmitAbort(null);
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

      const data = await apiRequest<IdentifyResponse>(
        "/api/identify?mode=three",
        {
          method: "POST",
          body: fd,
          signal: controller.signal,
        }
      );

      const found = data.ai?.candidates ?? [];
      setIdentifyData(data);
      setSelectedIndex(0);
      loadDraftFromCandidate(found[0]);
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setSubmitError((err as Error).message || "Identify failed.");
      }
    } finally {
      setIsSubmitting(false);
      setSubmitAbort(null);
    }
  }

  function chooseCandidate(index: number) {
    setSelectedIndex(index);
    loadDraftFromCandidate(candidates[index]);
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
        category: draft.category.trim(),
        status: draft.status,
        ai_primary: identifyData?.ai || selectedCandidate || null,
        ai_alternatives: candidates.length > 1 ? { candidates: candidates.slice(1) } : null,
        ai_chosen_index: selectedIndex,
        stored_images: storedImages,
      };

      const result = await apiRequest<{ id: string }>("/api/parts", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setPhotos([]);
      clearSession();
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
        title="Scan / Add"
        description="Capture up to 5 photos, identify part suggestions, then edit before saving."
        action={
          <button
            onClick={submitIdentify}
            disabled={isSubmitting || photos.length === 0}
            className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
          >
            {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Filter size={14} />}
            {submitAbort ? "Cancel" : "Submit for ID"}
          </button>
        }
      />

      <section className="border border-neutral-800 rounded-lg p-4 bg-neutral-900/40 space-y-3">
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
            onClick={() => {
              setPhotos([]);
              clearSession();
            }}
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

        {submitError && <p className="text-sm text-red-400">{submitError}</p>}
      </section>

      {notice && <p className="text-sm text-emerald-400">{notice}</p>}

      {identifyData && candidates.length > 0 && (
        <section className="border border-neutral-800 rounded-lg p-4 bg-neutral-900/40 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-neutral-200">Suggested matches</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={submitIdentify}
                disabled={isSubmitting || photos.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-700 rounded-md text-sm text-neutral-300 hover:text-neutral-100 hover:border-neutral-600 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isSubmitting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {submitAbort ? "Cancel" : "Try again"}
              </button>
              <button
                onClick={clearSession}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-neutral-700 rounded-md text-sm text-neutral-300 hover:text-neutral-100 hover:border-neutral-600"
              >
                Discard
              </button>
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              {candidates.map((candidate, idx) => (
                <button
                  key={`${candidate.name || "unknown"}-${idx}`}
                  onClick={() => chooseCandidate(idx)}
                  className={[
                    "w-full text-left border rounded-md p-3 transition-colors",
                    idx === selectedIndex
                      ? "border-blue-500 bg-blue-500/10"
                      : "border-neutral-800 hover:border-neutral-600 bg-neutral-950",
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-neutral-100 truncate">
                      {candidate.name || "Unknown"}
                    </p>
                    <span className="text-xs text-neutral-500 shrink-0">
                      {candidate.unknown
                        ? "unknown"
                        : `conf ${(candidate.confidence || 0).toFixed(2)}`}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-500 mt-1 line-clamp-2">
                    {candidate.description || "No description"}
                  </p>
                </button>
              ))}
            </div>

            <div className="lg:col-span-2 space-y-3">
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
                      Category
                    </label>
                    <input
                      value={draft.category}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, category: e.target.value }))
                      }
                      className="w-full bg-neutral-950 border border-neutral-700 rounded-md px-3 py-2 text-sm text-neutral-200 outline-none focus:border-neutral-500"
                    />
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

                <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3">
                  <p className="text-xs uppercase tracking-wide text-neutral-500 mb-1">
                    Evidence
                  </p>
                  <p className="text-sm text-neutral-400">
                    {selectedCandidate?.evidence || "No evidence returned."}
                  </p>
                </div>
              </div>

              <div className="sticky bottom-0 -mx-4 px-4 py-3 border-t border-neutral-800 bg-neutral-900/95 backdrop-blur md:static md:mx-0 md:px-0 md:py-0 md:border-0 md:bg-transparent md:backdrop-blur-none">
                <button
                  onClick={savePart}
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                >
                  {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save Part
                </button>
              </div>

              {saveError && <p className="text-sm text-red-400">{saveError}</p>}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  const token = localStorage.getItem("stowge_token");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (!(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();

  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!res.ok) {
    const detail =
      typeof payload === "object" && payload && "detail" in payload
        ? String((payload as { detail: unknown }).detail)
        : `HTTP ${res.status}`;
    throw new Error(detail);
  }

  return payload as T;
}

function isWindowsChrome(): boolean {
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
  if (isWindowsChrome()) {
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
