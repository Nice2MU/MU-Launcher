export interface AlphaMeshData {
  mask: Uint8Array;      // cols * rows (1 = opaque, 0 = transparent)
  indices: Uint16Array;  // filtered triangle indices (Uint16Array matches MeshPlane!)
  uvs: Float32Array;     // cols * rows * 2
}

const meshCache = new Map<string, AlphaMeshData>();

/**
 * Extracts an opacity mask at `cols x rows` AND builds filtered triangle indices
 * using a fine 3x-resolution alpha check so triangles NEVER bridge across
 * narrow transparent gaps (like between two boots or between arm and bag).
 */
export async function getPartAlphaMesh(
  imageDataUrl: string,
  cols: number,
  rows: number
): Promise<AlphaMeshData | null> {
  if (typeof document === 'undefined' || !imageDataUrl) return null;
  const key = `${cols}x${rows}:${imageDataUrl.slice(0, 64)}:${imageDataUrl.length}`;
  const cached = meshCache.get(key);
  if (cached) return cached;

  const img = new Image();
  img.src = imageDataUrl;
  await img.decode();

  // Fine alpha map (3x mesh resolution, e.g. 192x192 for 64x64 mesh -> ~8px precision)
  const fineCols = cols * 3;
  const fineRows = rows * 3;
  const canvas = document.createElement('canvas');
  canvas.width = fineCols;
  canvas.height = fineRows;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, fineCols, fineRows);
  ctx.drawImage(img, 0, 0, fineCols, fineRows);
  const data = ctx.getImageData(0, 0, fineCols, fineRows).data;

  const isFineOpaque = (fx: number, fy: number): boolean => {
    const cx = Math.max(0, Math.min(fineCols - 1, Math.round(fx)));
    const cy = Math.max(0, Math.min(fineRows - 1, Math.round(fy)));
    return data[(cy * fineCols + cx) * 4 + 3] > 16;
  };

  // Coarse mask at mesh vertex resolution
  const mask = new Uint8Array(cols * rows);
  const uvs = new Float32Array(cols * rows * 2);

  for (let r = 0; r < rows; r++) {
    const v = r / (rows - 1);
    const fy = v * (fineRows - 1);
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const fx = u * (fineCols - 1);
      const idx = r * cols + c;
      uvs[idx * 2] = u;
      uvs[idx * 2 + 1] = v;

      // Opaque if vertex or immediate fine neighbor is opaque
      let solid = isFineOpaque(fx, fy);
      if (!solid) {
        solid =
          isFineOpaque(fx - 1, fy) ||
          isFineOpaque(fx + 1, fy) ||
          isFineOpaque(fx, fy - 1) ||
          isFineOpaque(fx, fy + 1);
      }
      mask[idx] = solid ? 1 : 0;
    }
  }

  // Check if a segment between two mesh vertices crosses a transparent gap
  const edgeCrossesGap = (c0: number, r0: number, c1: number, r1: number): boolean => {
    const fx0 = (c0 / (cols - 1)) * (fineCols - 1);
    const fy0 = (r0 / (rows - 1)) * (fineRows - 1);
    const fx1 = (c1 / (cols - 1)) * (fineCols - 1);
    const fy1 = (r1 / (rows - 1)) * (fineRows - 1);
    // Only check gap if both endpoints are opaque; if one is outside, edge is outer boundary
    if (!mask[r0 * cols + c0] || !mask[r1 * cols + c1]) return false;
    for (const t of [0.25, 0.5, 0.75]) {
      if (!isFineOpaque(fx0 + (fx1 - fx0) * t, fy0 + (fy1 - fy0) * t)) {
        return true;
      }
    }
    return false;
  };

  const triList: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i00 = r * cols + c;
      const i10 = r * cols + (c + 1);
      const i01 = (r + 1) * cols + c;
      const i11 = (r + 1) * cols + (c + 1);

      // Triangle 1: (00, 10, 11)
      if (
        (mask[i00] || mask[i10] || mask[i11]) &&
        !edgeCrossesGap(c, r, c + 1, r) &&
        !edgeCrossesGap(c + 1, r, c + 1, r + 1) &&
        !edgeCrossesGap(c, r, c + 1, r + 1)
      ) {
        triList.push(i00, i10, i11);
      }

      // Triangle 2: (00, 11, 01)
      if (
        (mask[i00] || mask[i11] || mask[i01]) &&
        !edgeCrossesGap(c, r, c + 1, r + 1) &&
        !edgeCrossesGap(c + 1, r + 1, c, r + 1) &&
        !edgeCrossesGap(c, r, c, r + 1)
      ) {
        triList.push(i00, i11, i01);
      }
    }
  }

  const result: AlphaMeshData = {
    mask,
    indices: new Uint16Array(triList),
    uvs,
  };
  meshCache.set(key, result);
  return result;
}

export function getCachedAlphaMesh(
  imageDataUrl: string,
  cols: number,
  rows: number
): AlphaMeshData | undefined {
  if (!imageDataUrl) return undefined;
  const key = `${cols}x${rows}:${imageDataUrl.slice(0, 64)}:${imageDataUrl.length}`;
  return meshCache.get(key);
}
