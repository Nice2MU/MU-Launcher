/**
 * Computes the principal axis tilt angle (in degrees, clamped to [-45, 45])
 * of a part's opaque pixels so tilted eyes blink along their natural lash line.
 */
export function isEyePartName(name: string): boolean {
  return /eye/i.test(name) && !/brow|cheek/i.test(name);
}

export function computeTiltFromAlphaRgba(
  data: Uint8ClampedArray,
  w: number,
  h: number
): number {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 40) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }
  if (count < 16) return 0;
  const mx = sumX / count;
  const my = sumY / count;
  let cxx = 0;
  let cyy = 0;
  let cxy = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 40) {
        const dx = x - mx;
        const dy = y - my;
        cxx += dx * dx;
        cyy += dy * dy;
        cxy += dx * dy;
      }
    }
  }
  const angleDeg = (0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180) / Math.PI;
  return Math.max(-45, Math.min(45, angleDeg));
}

export async function computePartTiltDegFromDataUrl(dataUrl: string): Promise<number> {
  if (typeof document === 'undefined' || !dataUrl) return 0;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx || canvas.width === 0 || canvas.height === 0) {
          resolve(0);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve(computeTiltFromAlphaRgba(imgData.data, canvas.width, canvas.height));
      } catch {
        resolve(0);
      }
    };
    img.onerror = () => resolve(0);
    img.src = dataUrl;
  });
}
