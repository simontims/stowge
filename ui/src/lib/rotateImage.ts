/**
 * Rotate an image file 90° clockwise and return a new File.
 */
export function rotateImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const { naturalWidth: w, naturalHeight: h } = img;
      const canvas = document.createElement("canvas");
      canvas.width = h;
      canvas.height = w;
      const ctx = canvas.getContext("2d")!;
      ctx.translate(h, 0);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name, { type: file.type || "image/jpeg" }));
        },
        file.type || "image/jpeg",
        0.92
      );
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });
}
