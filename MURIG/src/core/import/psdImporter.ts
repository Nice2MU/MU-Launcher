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
  zCounter: { value: number },
  inheritedOpacity = 1,
  inheritedVisible = true
): void {
  if (!layers) return;
  for (const layer of layers) {
    const layerOpacity = inheritedOpacity * (layer.opacity ?? 1);
    const layerVisible = inheritedVisible && !layer.hidden;
    if (layer.children && layer.children.length > 0) {
      collectLeafLayers(
        layer.children,
        [...groupPath, layer.name ?? 'Group'],
        out,
        zCounter,
        layerOpacity,
        layerVisible
      );
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
        visible: layerVisible,
        alpha: Math.max(0, Math.min(1, layerOpacity * (layer.fillOpacity ?? 1))),
        imageDataUrl: dataUrl,
      });
    }
  }
}

const PART_SUBGROUP_RE =
  /^(\d+[_\s-]|face|head|body|hair|arm|leg|hand|foot|eye|brow|mouth|ear|nose|cloth|skirt|coat|weapon|prop|wing|tail|shadow|fx|effect)/i;

function isCategoryOrContainerGroup(layer: Layer): boolean {
  const children = layer.children ?? [];
  if (children.length === 0) return false;
  // Direct leaf layers mean this group is a rig root itself, not a category/character wrapper.
  const hasDirectLeaf = children.some((c) => !c.children || c.children.length === 0);
  if (hasDirectLeaf) return false;

  // If children are body-part subgroups (e.g. Face, Head, 01_Body), this group is the rig root.
  // Otherwise (e.g. Char -> Akane -> 001aka-n, NPC -> Haqua -> haqua-n), keep unwrapping.
  const hasPartSubgroup = children.some((c) => PART_SUBGROUP_RE.test((c.name ?? '').trim()));
  return !hasPartSubgroup;
}

interface RigRootEntry {
  layer: Layer;
  hidden: boolean;
  parentName?: string;
}

function collectRigRoots(
  layers: Layer[] | undefined,
  parentHidden: boolean,
  parentName: string | undefined,
  out: RigRootEntry[]
) {
  if (!layers) return;
  for (const layer of layers) {
    if (!layer.children || layer.children.length === 0) continue;
    const isHidden = parentHidden || Boolean(layer.hidden);
    if (isCategoryOrContainerGroup(layer)) {
      collectRigRoots(layer.children, isHidden, layer.name ?? parentName, out);
    } else {
      out.push({ layer, hidden: isHidden, parentName });
    }
  }
}

export interface PsdCharacterEntry {
  name: string;
  parentName?: string;
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
  const rigRoots: RigRootEntry[] = [];

  collectRigRoots(psd.children, false, undefined, rigRoots);

  // Fallback: if no groups found, treat entire PSD as one character
  if (rigRoots.length === 0 && (psd.children?.length ?? 0) > 0) {
    rigRoots.push({
      layer: {
        name: 'Character',
        children: psd.children,
      },
      hidden: false,
    });
  }

  const entries: PsdCharacterEntry[] = [];

  for (const { layer: grp, hidden: grpHidden, parentName } of rigRoots) {
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
      parentName,
      hidden: grpHidden,
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
