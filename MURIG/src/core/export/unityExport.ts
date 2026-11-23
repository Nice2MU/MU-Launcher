import { Character, Part } from '../model/types';

export interface UnityRigExportOptions {
  exportName: string;
  selectedPartIds: string[];
  includeMeshWeights?: boolean;
  includeClips?: boolean;
  pixelsPerUnit?: number;
  atlasMode?: boolean;
  padding?: number;
}

export interface AtlasRegion {
  partId: string;
  regionName: string;
  x: number;
  y: number;
  w: number;
  h: number;
  uv: {
    u0: number;
    v0: number;
    u1: number;
    v1: number;
  };
}

export interface AtlasPackResult {
  atlasWidth: number;
  atlasHeight: number;
  regions: AtlasRegion[];
  regionByPartId: Record<string, AtlasRegion>;
}

export interface UnityRigExportFile {
  fileName: string;
  bytes: Uint8Array;
}

export interface UnityRigExportBundle {
  exportName: string;
  atlasMode: boolean;
  atlasWidth: number;
  atlasHeight: number;
  atlasText: string;
  regions: AtlasRegion[];
  rigJson: string;
  textures: UnityRigExportFile[];
}

export function sanitizeFileName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]/g, '_');
  return cleaned || 'character';
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const idx = dataUrl.indexOf(',');
  const b64 = idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function buildUniqueName(rawName: string, usedNames: Set<string>, ext = ''): string {
  const base = sanitizeFileName(rawName);
  let candidate = `${base}${ext}`;
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${base}_${counter}${ext}`;
    counter++;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Shelf-packs selected parts into a single Texture Atlas while preserving every part's
 * exact original pixel dimensions (w x h).
 */
export function packAtlasRegions(parts: Part[], padding = 4): AtlasPackResult {
  if (parts.length === 0) {
    return { atlasWidth: 1, atlasHeight: 1, regions: [], regionByPartId: {} };
  }

  const usedNames = new Set<string>();
  const items = parts.map((part) => ({
    part,
    w: Math.max(1, Math.round(part.w)),
    h: Math.max(1, Math.round(part.h)),
    regionName: buildUniqueName(part.name, usedNames),
  }));

  // Sort tallest first for compact shelf packing
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w);

  const maxPartW = Math.max(...sorted.map((it) => it.w + padding * 2));
  const totalArea = sorted.reduce(
    (acc, it) => acc + (it.w + padding * 2) * (it.h + padding * 2),
    0
  );
  const targetWidth = Math.max(
    maxPartW,
    Math.ceil(Math.sqrt(totalArea * 1.25) / 32) * 32
  );

  let cursorX = padding;
  let cursorY = padding;
  let shelfHeight = 0;
  let usedWidth = padding;

  const placed: Array<{
    partId: string;
    regionName: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }> = [];

  for (const item of sorted) {
    if (cursorX > padding && cursorX + item.w + padding > targetWidth) {
      cursorX = padding;
      cursorY += shelfHeight + padding;
      shelfHeight = 0;
    }

    placed.push({
      partId: item.part.id,
      regionName: item.regionName,
      x: cursorX,
      y: cursorY,
      w: item.w,
      h: item.h,
    });

    cursorX += item.w + padding;
    usedWidth = Math.max(usedWidth, cursorX);
    shelfHeight = Math.max(shelfHeight, item.h);
  }

  const atlasWidth = Math.max(1, usedWidth);
  const atlasHeight = Math.max(1, cursorY + shelfHeight + padding);

  const regionByPartId: Record<string, AtlasRegion> = {};
  for (const p of placed) {
    const region: AtlasRegion = {
      partId: p.partId,
      regionName: p.regionName,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      uv: {
        u0: Number((p.x / atlasWidth).toFixed(6)),
        v0: Number((p.y / atlasHeight).toFixed(6)),
        u1: Number(((p.x + p.w) / atlasWidth).toFixed(6)),
        v1: Number(((p.y + p.h) / atlasHeight).toFixed(6)),
      },
    };
    regionByPartId[p.partId] = region;
  }

  // Return regions ordered by original part list for predictable output
  const orderedRegions = parts
    .map((p) => regionByPartId[p.id])
    .filter((r): r is AtlasRegion => Boolean(r));

  return {
    atlasWidth,
    atlasHeight,
    regions: orderedRegions,
    regionByPartId,
  };
}

/**
 * Generates a Spine-compatible `.atlas` descriptor matching standard Unity 2D atlas conventions.
 */
export function buildUnityAtlasText(
  pngFileName: string,
  atlasWidth: number,
  atlasHeight: number,
  regions: AtlasRegion[]
): string {
  const lines: string[] = [
    pngFileName,
    `size: ${atlasWidth}, ${atlasHeight}`,
    'format: RGBA8888',
    'filter: Linear, Linear',
    'repeat: none',
  ];

  for (const r of regions) {
    lines.push(
      r.regionName,
      '  rotate: false',
      `  xy: ${r.x}, ${r.y}`,
      `  size: ${r.w}, ${r.h}`,
      `  orig: ${r.w}, ${r.h}`,
      '  offset: 0, 0',
      '  index: -1'
    );
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Renders the packed Texture Atlas onto an HTML5 Canvas at exact 1:1 original part pixel sizes.
 */
export async function renderAtlasCanvas(
  parts: Part[],
  pack: AtlasPackResult
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = pack.atlasWidth;
  canvas.height = pack.atlasHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const partMap = new Map(parts.map((p) => [p.id, p]));

  await Promise.all(
    pack.regions.map(
      (region) =>
        new Promise<void>((resolve) => {
          const part = partMap.get(region.partId);
          if (!part?.imageDataUrl) {
            resolve();
            return;
          }
          const img = new Image();
          img.onload = () => {
            ctx.drawImage(img, region.x, region.y, region.w, region.h);
            resolve();
          };
          img.onerror = () => resolve();
          img.src = part.imageDataUrl;
        })
    )
  );

  return canvas;
}

export async function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  );
  if (!blob) throw new Error('Failed to encode atlas PNG');
  const buf = await blob.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Builds a Unity-ready `.rig.json` + `.atlas` (or loose PNGs when `atlasMode: false`).
 */
export function buildUnityRigExport(
  character: Character,
  options: UnityRigExportOptions
): UnityRigExportBundle {
  const exportName = sanitizeFileName(options.exportName || character.name);
  const selectedSet = new Set(options.selectedPartIds);
  const includeMeshWeights = options.includeMeshWeights ?? true;
  const includeClips = options.includeClips ?? true;
  const pixelsPerUnit = options.pixelsPerUnit ?? 100;
  const atlasMode = options.atlasMode ?? true;
  const padding = options.padding ?? 4;

  const selectedParts = character.parts.filter((p) => selectedSet.has(p.id));
  const pack = atlasMode
    ? packAtlasRegions(selectedParts, padding)
    : { atlasWidth: 0, atlasHeight: 0, regions: [], regionByPartId: {} };

  const usedFileNames = new Set<string>();
  const textures: UnityRigExportFile[] = [];
  const exportedParts = [];

  for (const part of selectedParts) {
    const region = pack.regionByPartId[part.id];
    const looseFileName = atlasMode ? undefined : buildUniqueName(part.name, usedFileNames, '.png');

    if (!atlasMode && looseFileName && part.imageDataUrl) {
      textures.push({
        fileName: looseFileName,
        bytes: dataUrlToBytes(part.imageDataUrl),
      });
    }

    exportedParts.push({
      id: part.id,
      name: part.name,
      ...(atlasMode && region
        ? {
            regionName: region.regionName,
            atlasRect: { x: region.x, y: region.y, w: region.w, h: region.h },
            uv: region.uv,
          }
        : {
            texture: `textures/${looseFileName}`,
          }),
      boneId: part.boneId,
      groupId: part.groupId ?? null,
      x: part.x,
      y: part.y,
      w: part.w,
      h: part.h,
      pivot: part.pivot,
      z: part.z,
      visible: part.visible,
      alpha: part.alpha,
      parallax: part.parallax,
      ...(part.scaleAngle !== undefined ? { scaleAngle: part.scaleAngle } : {}),
      ...(part.skinned ? { skinned: true } : {}),
      ...(includeMeshWeights && part.meshWeights ? { meshWeights: part.meshWeights } : {}),
    });
  }

  const pngFileName = `${exportName}.png`;
  const atlasFileName = `${exportName}.atlas`;
  const atlasText = atlasMode
    ? buildUnityAtlasText(pngFileName, pack.atlasWidth, pack.atlasHeight, pack.regions)
    : '';

  const rigDoc = {
    version: 2,
    format: 'murig-unity-rig',
    exportName,
    characterName: character.name,
    canvasWidth: character.canvasWidth,
    canvasHeight: character.canvasHeight,
    pixelsPerUnit,
    ...(atlasMode
      ? {
          atlasTexture: pngFileName,
          atlasFile: atlasFileName,
          atlasWidth: pack.atlasWidth,
          atlasHeight: pack.atlasHeight,
        }
      : {}),
    bones: character.bones,
    partGroups: character.partGroups ?? [],
    parts: exportedParts,
    params: character.params,
    clips: includeClips ? character.clips ?? [] : [],
  };

  return {
    exportName,
    atlasMode,
    atlasWidth: pack.atlasWidth,
    atlasHeight: pack.atlasHeight,
    atlasText,
    regions: pack.regions,
    rigJson: JSON.stringify(rigDoc, null, 2),
    textures,
  };
}
