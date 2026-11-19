// Picked/pasted/dropped files into Anthropic base64 image blocks, within the
// limits happy_flutter uses (the server's JSON cap is the binding one).

/** Long edge after downscaling: the API's sweet spot (as happy_flutter). */
const MAX_DIMENSION = 1568;
/** Per-image base64 cap: happy-cli-go's JSON limit is the binding one. */
export const MAX_IMAGE_BASE64 = 3_400_000;
/** Total base64 across the images of one message. */
export const MAX_TOTAL_BASE64 = 3_600_000;
const SEND_AS_IS = new Set(["image/png", "image/jpeg"]);

export interface Attachment {
  /** `data:` URL, used for the preview and stored on the optimistic row. */
  url: string;
  mime: "image/png" | "image/jpeg";
  /** Base64 payload of the Anthropic `image` block. */
  data: string;
}

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",", 2)[1] ?? "");
    r.onerror = () => reject(r.error ?? new Error("could not read the image"));
    r.readAsDataURL(blob);
  });

const encode = (canvas: HTMLCanvasElement, mime: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode the image"))), mime, quality));

/** Downscales to MAX_DIMENSION and re-encodes as JPEG until it fits;
 * small PNG/JPEG files are sent untouched. */
export async function prepareImage(file: Blob): Promise<Attachment> {
  if (!file.type.startsWith("image/")) throw new Error("Only images can be attached");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && SEND_AS_IS.has(file.type) && file.size * 1.37 < MAX_IMAGE_BASE64) {
      const data = await toBase64(file);
      const mime = file.type as Attachment["mime"];
      return { url: `data:${mime};base64,${data}`, mime, data };
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("could not process the image");
    ctx.fillStyle = "#fff"; // JPEG has no alpha: flatten onto white
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (let q = 0.88; ; q -= 0.12) {
      const data = await toBase64(await encode(canvas, "image/jpeg", q));
      if (data.length <= MAX_IMAGE_BASE64 || q < 0.4) {
        if (data.length > MAX_IMAGE_BASE64) throw new Error("Image is too large to send");
        return { url: `data:image/jpeg;base64,${data}`, mime: "image/jpeg", data };
      }
    }
  } finally {
    bitmap.close();
  }
}
