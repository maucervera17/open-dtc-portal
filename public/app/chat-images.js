// Screenshots for the chat: file-type rules and the client-side downscale. Everything stays in memory; the server never
// stores the images and neither does this module.
export const MAX_IMAGES = 3;
export const ACCEPT = 'image/png,image/jpeg,image/webp';
export const ACCEPTED_TYPES = new Set(ACCEPT.split(','));
export const MAX_EDGE = 1600; // px, long edge
export const JPEG_QUALITY = 0.85;
const MIN_QUALITY = 0.5;
// Per image, decoded. Three of these are about 4.0 MB once base64 encoded, inside the server's 4 MB payload cap and
// Vercel's 4.5 MB body limit, and under the 1.5 MB per-image target.
export const MAX_IMAGE_BYTES = 1000000;
const SHRINK = 0.75;
const ROUNDS = 6;

// A canvas that works on the main thread and in workers: OffscreenCanvas when it exists, a detached <canvas> otherwise.
function defaultCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasBlob(canvas, quality) {
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('encode_failed'))), 'image/jpeg', quality));
}

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// Decodes the file, scales it so the long edge is at most 1600 px (never up), and re-encodes it as JPEG at quality 0.85.
// An image over the per-image budget gets a lower quality and then a smaller size until it fits. Transparent areas are
// painted white first, because JPEG has no alpha. Resolves { blob, mime, data } with `data` as base64; rejects when the
// file cannot be decoded or cannot be made small enough.
export async function prepareImage(file, { createBitmap = f => createImageBitmap(f), makeCanvas = defaultCanvas } = {}) {
  const bitmap = await createBitmap(file);
  try {
    let scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    for (let round = 0; round < ROUNDS; round++) {
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = makeCanvas(width, height);
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      for (let quality = JPEG_QUALITY; quality >= MIN_QUALITY - 1e-9; quality = Math.round((quality - 0.1) * 100) / 100) {
        const blob = await canvasBlob(canvas, quality);
        if (blob.size <= MAX_IMAGE_BYTES) return { blob, mime: 'image/jpeg', data: await toBase64(blob) };
      }
      scale *= SHRINK;
    }
    throw new Error('too_large');
  } finally {
    try { bitmap.close?.(); } catch { /* already released */ }
  }
}

// The panel calls through here so tests can swap the canvas work for a fake.
export const hooks = { prepare: file => prepareImage(file) };
