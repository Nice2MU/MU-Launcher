import { Character, MurigProject, Part, VertexWeightMap } from '../model/types';
import type { PsdCharacterEntry } from './psdImporter';

export interface PsdMergeSummary {
  updatedParts: number;
  addedParts: number;
  addedCharacters: number;
}

/**
 * Resamples an existing part's meshWeights onto newPart's bounding box in world coordinates
 * using bilinear interpolation, preserving painted weights even if the PSD layer was trimmed/expanded.
 */
function resampleMeshWeights(oldPart: Part, newPart: Part): VertexWeightMap | undefined {
  const oldMw = oldPart.meshWeights;
  if (!oldMw || oldMw.cols < 2 || oldMw.rows < 2) return undefined;
  if (
    oldPart.x === newPart.x &&
    oldPart.y === newPart.y &&
    oldPart.w === newPart.w &&
    oldPart.h === newPart.h
  ) {
    return oldMw;
  }

  const { cols, rows, weights } = oldMw;
  const oldW = Math.max(1, oldPart.w);
  const oldH = Math.max(1, oldPart.h);
  const out: Record<string, number>[] = new Array(cols * rows);

  for (let r = 0; r < rows; r++) {
    const vy = newPart.y + (r / (rows - 1)) * newPart.h;
    const fy = Math.max(0, Math.min(1, (vy - oldPart.y) / oldH)) * (rows - 1);
    const r0 = Math.floor(fy);
    const r1 = Math.min(rows - 1, r0 + 1);
    const ty = fy - r0;

    for (let c = 0; c < cols; c++) {
      const vx = newPart.x + (c / (cols - 1)) * newPart.w;
      const fx = Math.max(0, Math.min(1, (vx - oldPart.x) / oldW)) * (cols - 1);
      const c0 = Math.floor(fx);
      const c1 = Math.min(cols - 1, c0 + 1);
      const tx = fx - c0;

      const w00 = weights[r0 * cols + c0] ?? {};
      const w10 = weights[r0 * cols + c1] ?? {};
      const w01 = weights[r1 * cols + c0] ?? {};
      const w11 = weights[r1 * cols + c1] ?? {};

      const merged: Record<string, number> = {};
      const addWeighted = (src: Record<string, number>, factor: number) => {
        if (factor <= 0) return;
        for (const [k, v] of Object.entries(src)) {
          if (v > 0) merged[k] = (merged[k] ?? 0) + v * factor;
        }
      };

      addWeighted(w00, (1 - tx) * (1 - ty));
      addWeighted(w10, tx * (1 - ty));
      addWeighted(w01, (1 - tx) * ty);
      addWeighted(w11, tx * ty);

      let sum = 0;
      for (const v of Object.values(merged)) sum += v;
      if (sum > 1e-6) {
        for (const k of Object.keys(merged)) {
          merged[k] /= sum;
          if (merged[k] < 1e-4) delete merged[k];
        }
      }
      out[r * cols + c] = merged;
    }
  }

  return { cols, rows, weights: out };
}

function mergeCharacter(
  oldChar: Character,
  newChar: Character,
  summary: PsdMergeSummary
): Character {
  const oldByName = new Map<string, Part>();
  for (const p of oldChar.parts) {
    oldByName.set(p.name.toLowerCase(), p);
  }

  const usedOldIds = new Set<string>();
  const mergedParts: Part[] = [];

  for (const np of newChar.parts) {
    const match = oldByName.get(np.name.toLowerCase());
    if (match && !usedOldIds.has(match.id)) {
      usedOldIds.add(match.id);
      summary.updatedParts++;
      mergedParts.push({
        ...match,
        name: np.name,
        imageDataUrl: np.imageDataUrl,
        x: np.x,
        y: np.y,
        w: np.w,
        h: np.h,
        z: np.z,
        scaleAngle: undefined, // re-detect eye tilt from updated image
        meshWeights: resampleMeshWeights(match, np),
      });
    } else {
      summary.addedParts++;
      let id = np.id;
      while (usedOldIds.has(id) || mergedParts.some((p) => p.id === id)) {
        id = `${np.id}_${Math.random().toString(36).slice(2, 6)}`;
      }
      mergedParts.push({ ...np, id });
    }
  }

  // Keep any old parts that were manually added or not in the new PSD only?
  // No: PSD is the source of truth for art layers, so removed PSD layers are omitted,
  // while all bones, partGroups, params, and clips remain intact.
  return {
    ...oldChar,
    canvasWidth: newChar.canvasWidth,
    canvasHeight: newChar.canvasHeight,
    parts: mergedParts,
    warnings: newChar.warnings,
  };
}

/**
 * Merges newly imported PSD character entries into an existing MurigProject,
 * preserving bones, PartGroups, params, clips, and world-space meshWeights.
 */
export function mergePsdIntoProject(
  project: MurigProject,
  entries: PsdCharacterEntry[],
  sourcePsdPath?: string
): { project: MurigProject; summary: PsdMergeSummary } {
  const summary: PsdMergeSummary = {
    updatedParts: 0,
    addedParts: 0,
    addedCharacters: 0,
  };

  const entryByName = new Map<string, PsdCharacterEntry>();
  for (const e of entries) {
    entryByName.set(e.name.toLowerCase(), e);
  }

  const matchedNames = new Set<string>();
  const nextChars: Character[] = project.characters.map((ch) => {
    const entry = entryByName.get(ch.name.toLowerCase());
    if (!entry) return ch;
    matchedNames.add(entry.name.toLowerCase());
    return mergeCharacter(ch, entry.character, summary);
  });

  for (const e of entries) {
    if (!matchedNames.has(e.name.toLowerCase())) {
      summary.addedCharacters++;
      nextChars.push(e.character);
    }
  }

  return {
    project: {
      ...project,
      sourcePsdPath: sourcePsdPath ?? project.sourcePsdPath,
      characters: nextChars,
    },
    summary,
  };
}
