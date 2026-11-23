import { readPsd, Layer } from 'ag-psd';
import { Character, ImportWarning, Part } from '../model/types';
import { buildAutoRig } from '../rig/autoRig';

export interface RawLayerPart {
  name: string;
  groupPath: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  visible: boolean;
  alpha: number;
  imageDataUrl: string;
}

function trimCanvasToDataUrl(
  canvas: HTMLCanvasElement,
  origLeft: number,
  origTop: number
): { dataUrl: string; x: number; y: number; w: number; h: number } | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const { width, height } = canvas;
  if (width === 0 || height === 0) return null;

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let py = 0; py < height; py++) {
    const rowOffset = py * width * 4;
    for (let px = 0; px < width; px++) {
      if (data[rowOffset + px * 4 + 3] > 2) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return null; // completely transparent
  }

  const trimW = maxX - minX + 1;
  const trimH = maxY - minY + 1;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = trimW;
  outCanvas.height = trimH;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) return null;

  outCtx.drawImage(canvas, minX, minY, trimW, trimH, 0, 0, trimW, trimH);

  return {
    dataUrl: outCanvas.toDataURL('image/png'),
    x: origLeft + minX,
    y: origTop + minY,
    w: trimW,
    h: trimH,
  };
}

function collectLeafLayers(
  layers: Layer[] | undefined,
  groupPath: string[],
  out: RawLayerPart[],
  zCounter: { value: number }
): void {
  if (!layers) return;
  for (const layer of layers) {
    if (layer.children && layer.children.length > 0) {
      collectLeafLayers(layer.children, [...groupPath, layer.name ?? 'Group'], out, zCounter);
    } else {
      const left = layer.left ?? 0;
      const top = layer.top ?? 0;
      const right = layer.right ?? left;
      const bottom = layer.bottom ?? top;
      const w = Math.max(0, right - left);
      const h = Math.max(0, bottom - top);
      if (w === 0 || h === 0) continue;

      let finalX = left;
      let finalY = top;
      let finalW = w;
      let finalH = h;
      let dataUrl = '';

      if (typeof document !== 'undefined' && layer.canvas) {
        const trimmed = trimCanvasToDataUrl(layer.canvas, left, top);
        if (!trimmed) continue;
        dataUrl = trimmed.dataUrl;
        finalX = trimmed.x;
        finalY = trimmed.y;
        finalW = trimmed.w;
        finalH = trimmed.h;
      }

      out.push({
        name: layer.name ?? `Layer_${zCounter.value}`,
        groupPath,
        x: finalX,
        y: finalY,
        w: finalW,
        h: finalH,
        z: zCounter.value++,
        visible: !layer.hidden,
        alpha: layer.opacity ?? 1,
        imageDataUrl: dataUrl,
      });
    }
  }
}

function looksLikeCharacterGroup(layer: Layer): boolean {
  if (!layer.children || layer.children.length === 0) return false;
  // A character group usually has leaf layers like Body/Head/Hair or Face/Head subgroups,
  // whereas a category folder (like NPC, Char) only contains character groups.
  const hasLeaf = layer.children.some((c) => !c.children || c.children.length === 0);
  if (hasLeaf) return true;
  // Or it has a Face/Head subgroup
  return layer.children.some((c) => /^(face|head|01_head)$/i.test((c.name ?? '').trim()));
}

export interface PsdCharacterEntry {
  name: string;
  hidden: boolean;
  layerCount: number;
  character: Character;
}

export function importPsdBuffer(buffer: ArrayBuffer | Uint8Array): {
  canvasWidth: number;
  canvasHeight: number;
  characters: PsdCharacterEntry[];
} {
  const skipImages = typeof document === 'undefined';
  const psd = readPsd(buffer, {
    skipLayerImageData: skipImages,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });

  const canvasWidth = psd.width;
  const canvasHeight = psd.height;
  const charGroups: Layer[] = [];

  for (const top of psd.children ?? []) {
    if (!top.children || top.children.length === 0) continue;
    if (looksLikeCharacterGroup(top)) {
      charGroups.push(top);
    } else {
      for (const sub of top.children) {
        if (sub.children && sub.children.length > 0) {
          charGroups.push(sub);
        }
      }
    }
  }

  // Fallback: if no groups found, treat entire PSD as one character
  if (charGroups.length === 0 && (psd.children?.length ?? 0) > 0) {
    charGroups.push({
      name: 'Character',
      children: psd.children,
    });
  }

  const entries: PsdCharacterEntry[] = [];

  for (const grp of charGroups) {
    const charName = grp.name ?? 'Character';
    const rawLayers: RawLayerPart[] = [];
    collectLeafLayers(grp.children, [], rawLayers, { value: 0 });

    const warnings: ImportWarning[] = [];
    const seenNames = new Map<string, number>();

    const parts: Part[] = rawLayers.map((raw, idx) => {
      let cleanName = raw.name.trim();
      const count = seenNames.get(cleanName) ?? 0;
      seenNames.set(cleanName, count + 1);
      if (count > 0) {
        const renamed = `${cleanName}_${count + 1}`;
        warnings.push({
          code: 'DUPLICATE_LAYER_NAME',
          message: `Duplicate layer "${cleanName}" renamed to "${renamed}"`,
          layerName: cleanName,
        });
        cleanName = renamed;
      }

      // Check if name has @variant syntax e.g. L_01_Eye@open
      const [baseName, variantName] = cleanName.split('@');

      return {
        id: `part_${idx}_${cleanName.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        name: cleanName,
        boneId: '', // assigned by autoRig
        imageDataUrl: raw.imageDataUrl,
        x: raw.x,
        y: raw.y,
        w: raw.w,
        h: raw.h,
        pivot: { x: raw.x + raw.w / 2, y: raw.y + raw.h / 2 },
        z: raw.z,
        visible: raw.visible,
        alpha: raw.alpha,
        parallax: 0,
        ...(variantName ? { activeVariant: variantName, variants: { [variantName]: raw.imageDataUrl } } : {}),
        // Store baseName implicitly via name
        ...(baseName !== cleanName ? {} : {}),
      };
    });

    const rigged = buildAutoRig(charName, canvasWidth, canvasHeight, parts, rawLayers, warnings);

    entries.push({
      name: charName,
      hidden: Boolean(grp.hidden),
      layerCount: parts.length,
      character: rigged,
    });
  }

  return {
    canvasWidth,
    canvasHeight,
    characters: entries,
  };
}
