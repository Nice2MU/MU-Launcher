import { BindingKey, BindingProp, Bone, Character, Param, Part, VertexWeightMap } from '../model/types';

export interface Mat2D {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export const IDENTITY_MAT: Mat2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

export function makeTRS(x: number, y: number, rotDeg: number, sx: number, sy: number): Mat2D {
  const rad = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    a: cos * sx,
    b: sin * sx,
    c: -sin * sy,
    d: cos * sy,
    tx: x,
    ty: y,
  };
}

export function mulMat(m1: Mat2D, m2: Mat2D): Mat2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    tx: m1.a * m2.tx + m1.c * m2.ty + m1.tx,
    ty: m1.b * m2.tx + m1.d * m2.ty + m1.ty,
  };
}

export function invertMat(m: Mat2D): Mat2D {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-8) return IDENTITY_MAT;
  const invDet = 1 / det;
  return {
    a: m.d * invDet,
    b: -m.b * invDet,
    c: -m.c * invDet,
    d: m.a * invDet,
    tx: (m.c * m.ty - m.d * m.tx) * invDet,
    ty: (m.b * m.tx - m.a * m.ty) * invDet,
  };
}

export function transformPoint(m: Mat2D, x: number, y: number): { x: number; y: number } {
  return {
    x: m.a * x + m.c * y + m.tx,
    y: m.b * x + m.d * y + m.ty,
  };
}

export function evaluateBindingKeys(keys: BindingKey[], paramVal: number): number {
  if (keys.length === 0) return 0;
  if (keys.length === 1) return keys[0].value;
  const sorted = [...keys].sort((a, b) => a.param - b.param);
  if (paramVal <= sorted[0].param) return sorted[0].value;
  if (paramVal >= sorted[sorted.length - 1].param) return sorted[sorted.length - 1].value;

  for (let i = 0; i < sorted.length - 1; i++) {
    const k0 = sorted[i];
    const k1 = sorted[i + 1];
    if (paramVal >= k0.param && paramVal <= k1.param) {
      const span = k1.param - k0.param;
      const t = span === 0 ? 0 : (paramVal - k0.param) / span;
      return k0.value + (k1.value - k0.value) * t;
    }
  }
  return sorted[0].value;
}

export interface SolvedBone {
  bone: Bone;
  restWorld: Mat2D;
  world: Mat2D;
  delta: Mat2D;
  worldPos: { x: number; y: number };
  tipPos: { x: number; y: number };
}

export interface SolvedPart {
  part: Part;
  worldMatrix: Mat2D;
  alpha: number;
}

export interface SolvedRig {
  bones: Map<string, SolvedBone>;
  parts: Map<string, SolvedPart>;
}

function accumulateParamOffsets(params: Param[]) {
  const boneOffsets = new Map<string, Partial<Record<BindingProp, number>>>();
  const partOffsets = new Map<string, Partial<Record<BindingProp, number>>>();

  let angleX = 0;
  let angleY = 0;

  for (const p of params) {
    if (p.id === 'AngleX') angleX = p.value;
    if (p.id === 'AngleY') angleY = p.value;

    for (const b of p.bindings) {
      const val = evaluateBindingKeys(b.keys, p.value);
      const map = b.targetType === 'bone' ? boneOffsets : partOffsets;
      let rec = map.get(b.targetId);
      if (!rec) {
        rec = {};
        map.set(b.targetId, rec);
      }
      if (b.prop === 'scaleX' || b.prop === 'scaleY' || b.prop === 'alpha') {
        rec[b.prop] = (rec[b.prop] ?? 1) * val;
      } else {
        rec[b.prop] = (rec[b.prop] ?? 0) + val;
      }
    }
  }

  return { boneOffsets, partOffsets, angleX, angleY };
}

export function solveRig(character: Character): SolvedRig {
  const { boneOffsets, partOffsets, angleX, angleY } = accumulateParamOffsets(character.params);
  const solvedBones = new Map<string, SolvedBone>();

  // Topological order (parents before children)
  const boneMap = new Map(character.bones.map((b) => [b.id, b]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: Bone[] = [];

  function visit(b: Bone) {
    if (visited.has(b.id) || visiting.has(b.id)) return;
    visiting.add(b.id);
    if (b.parentId && b.parentId !== b.id && boneMap.has(b.parentId)) {
      visit(boneMap.get(b.parentId)!);
    }
    visiting.delete(b.id);
    visited.add(b.id);
    ordered.push(b);
  }
  for (const b of character.bones) visit(b);

  for (const b of ordered) {
    const parentSolved = b.parentId ? solvedBones.get(b.parentId) : undefined;
    const off = boneOffsets.get(b.id);

    const restLocal = makeTRS(b.x, b.y, 0, 1, 1);
    const restWorld = parentSolved ? mulMat(parentSolved.restWorld, restLocal) : restLocal;

    const poseX = b.x + (off?.x ?? 0);
    const poseY = b.y + (off?.y ?? 0);
    const poseRot = b.rotation + (off?.rotation ?? 0);
    const poseSX = b.scaleX * (off?.scaleX ?? 1);
    const poseSY = b.scaleY * (off?.scaleY ?? 1);

    const poseLocal = makeTRS(poseX, poseY, poseRot, poseSX, poseSY);
    const world = parentSolved ? mulMat(parentSolved.world, poseLocal) : poseLocal;
    const delta = mulMat(world, invertMat(restWorld));

    const worldPos = transformPoint(world, 0, 0);
    const tipRad = (b.visualAngle * Math.PI) / 180;
    const tipPos = transformPoint(world, Math.cos(tipRad) * b.length, Math.sin(tipRad) * b.length);

    solvedBones.set(b.id, {
      bone: b,
      restWorld,
      world,
      delta,
      worldPos,
      tipPos,
    });
  }

  const groupMap = new Map((character.partGroups ?? []).map((g) => [g.id, g]));
  const solvedParts = new Map<string, SolvedPart>();
  for (const part of character.parts) {
    const group = part.groupId ? groupMap.get(part.groupId) : undefined;
    const effectiveBoneId = group ? group.boneId : part.boneId;
    const boneSolved = solvedBones.get(effectiveBoneId);
    const delta = boneSolved ? boneSolved.delta : IDENTITY_MAT;
    const off = partOffsets.get(part.id);

    const px = part.pivot.x;
    const py = part.pivot.y;
    const dx = (off?.x ?? 0) + angleX * part.parallax * 45;
    const dy = (off?.y ?? 0) + angleY * part.parallax * 30;
    const rot = off?.rotation ?? 0;
    const sx = off?.scaleX ?? 1;
    const sy = off?.scaleY ?? 1;
    const alpha = part.alpha * (off?.alpha ?? 1);

    // Local transform around pivot (respecting scaleAngle so tilted eyes blink along their lash line), then moved by bone delta
    const toPivot = makeTRS(-px, -py, 0, 1, 1);
    const scaleAngle = part.scaleAngle ?? 0;
    let partLocal: Mat2D;
    if (scaleAngle !== 0 && (Math.abs(sx - 1) > 1e-4 || Math.abs(sy - 1) > 1e-4)) {
      const unTilt = makeTRS(0, 0, -scaleAngle, 1, 1);
      const scaled = makeTRS(0, 0, 0, sx, sy);
      const reTilt = makeTRS(px + dx, py + dy, scaleAngle + rot, 1, 1);
      partLocal = mulMat(reTilt, mulMat(scaled, mulMat(unTilt, toPivot)));
    } else {
      const aroundPivot = makeTRS(px + dx, py + dy, rot, sx, sy);
      partLocal = mulMat(aroundPivot, toPivot);
    }
    const worldMatrix = mulMat(delta, partLocal);

    solvedParts.set(part.id, {
      part,
      worldMatrix,
      alpha,
    });
  }

  return { bones: solvedBones, parts: solvedParts };
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-6) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  return Math.hypot(px - cx, py - cy);
}

function computeGeodesicDistances(
  cols: number,
  rows: number,
  cellW: number,
  cellH: number,
  partX: number,
  partY: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  mask: Uint8Array
): Float32Array {
  const n = cols * rows;
  const dist = new Float32Array(n);
  dist.fill(1e9);

  // Simple binary min-heap of [dist, idx]
  const heapIdx: number[] = [];
  const heapDist: number[] = [];
  const push = (idx: number, d: number) => {
    heapIdx.push(idx);
    heapDist.push(d);
    let i = heapIdx.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapDist[p] <= heapDist[i]) break;
      [heapIdx[p], heapIdx[i]] = [heapIdx[i], heapIdx[p]];
      [heapDist[p], heapDist[i]] = [heapDist[i], heapDist[p]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const topIdx = heapIdx[0];
    const topD = heapDist[0];
    const lastIdx = heapIdx.pop()!;
    const lastD = heapDist.pop()!;
    if (heapIdx.length > 0) {
      heapIdx[0] = lastIdx;
      heapDist[0] = lastD;
      let i = 0;
      const len = heapIdx.length;
      while (true) {
        let best = i;
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        if (l < len && heapDist[l] < heapDist[best]) best = l;
        if (r < len && heapDist[r] < heapDist[best]) best = r;
        if (best === i) break;
        [heapIdx[i], heapIdx[best]] = [heapIdx[best], heapIdx[i]];
        [heapDist[i], heapDist[best]] = [heapDist[best], heapDist[i]];
        i = best;
      }
    }
    return [topIdx, topD];
  };

  // Seed opaque cells close to the bone segment
  const seedThresh = Math.max(45, Math.hypot(cellW, cellH) * 1.2);
  let bestSeed = -1;
  let bestSeedD = Infinity;

  for (let r = 0; r < rows; r++) {
    const vy = partY + r * cellH;
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const vx = partX + c * cellW;
      const d = distToSegment(vx, vy, ax, ay, bx, by);
      if (mask[idx] && d < bestSeedD) {
        bestSeedD = d;
        bestSeed = idx;
      }
      if (mask[idx] && d <= seedThresh) {
        dist[idx] = d;
        push(idx, d);
      }
    }
  }

  if (heapIdx.length === 0 && bestSeed >= 0) {
    dist[bestSeed] = bestSeedD;
    push(bestSeed, bestSeedD);
  }

  const diag = Math.hypot(cellW, cellH);
  const dirs: [number, number, number][] = [
    [1, 0, cellW],
    [-1, 0, cellW],
    [0, 1, cellH],
    [0, -1, cellH],
    [1, 1, diag],
    [-1, 1, diag],
    [1, -1, diag],
    [-1, -1, diag],
  ];

  while (heapIdx.length > 0) {
    const [u, d] = pop();
    if (d > dist[u]) continue;
    const ur = Math.floor(u / cols);
    const uc = u % cols;

    for (let k = 0; k < 8; k++) {
      const nc = uc + dirs[k][0];
      const nr = ur + dirs[k][1];
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const v = nr * cols + nc;
      if (!mask[v]) continue; // Never cross transparent gaps!
      const nd = d + dirs[k][2];
      if (nd < dist[v]) {
        dist[v] = nd;
        push(v, nd);
      }
    }
  }

  return dist;
}

/**
 * Generates Unity-style normalized per-vertex bone weights for a Part.
 */
export function generateAutoWeights(
  character: Character,
  part: Part,
  solvedRig: SolvedRig,
  cols: number,
  rows: number
): VertexWeightMap {
  const weights: Record<string, number>[] = new Array(cols * rows);
  const group = part.groupId ? (character.partGroups ?? []).find((g) => g.id === part.groupId) : undefined;
  const effectiveBoneId = group ? group.boneId : part.boneId;
  const primary = solvedRig.bones.get(effectiveBoneId);

  if (!primary) {
    for (let i = 0; i < weights.length; i++) weights[i] = {};
    return { cols, rows, weights };
  }

  const isBodyOrLimb = /^(root|torso|body|hood|backpack|.*arm.*|.*hand.*|.*thigh.*|.*shin.*|.*leg.*|.*foot.*)$/i.test(
    effectiveBoneId
  );
  const influenceIds = new Set<string>([effectiveBoneId]);
  if (isBodyOrLimb) {
    for (const b of character.bones) {
      if (
        /^(torso|body|hood|backpack|.*arm.*|.*hand.*|.*thigh.*|.*shin.*|.*leg.*|.*foot.*)$/i.test(b.id) ||
        /^(torso|body|hood|backpack|.*arm.*|.*hand.*|.*thigh.*|.*shin.*|.*leg.*|.*foot.*)$/i.test(b.name)
      ) {
        influenceIds.add(b.id);
      }
    }
  } else {
    if (primary.bone.parentId && primary.bone.parentId !== 'root') {
      influenceIds.add(primary.bone.parentId);
    }
    for (const b of character.bones) {
      if (b.parentId === effectiveBoneId) {
        influenceIds.add(b.id);
      }
    }
  }

  const mask = undefined;
  const cellW = part.w / Math.max(1, cols - 1);
  const cellH = part.h / Math.max(1, rows - 1);

  const influences: {
    id: string;
    ax: number;
    ay: number;
    bx: number;
    by: number;
    isPrimary: boolean;
    isLeaf: boolean;
    geoDist?: Float32Array;
  }[] = [];

  for (const id of influenceIds) {
    const sb = solvedRig.bones.get(id);
    if (!sb) continue;
    const a = transformPoint(sb.restWorld, 0, 0);
    const rad = (sb.bone.visualAngle * Math.PI) / 180;
    const b = transformPoint(
      sb.restWorld,
      Math.cos(rad) * sb.bone.length,
      Math.sin(rad) * sb.bone.length
    );
    const isLeaf = !character.bones.some((c) => c.parentId === id);
    const geoDist = mask
      ? computeGeodesicDistances(cols, rows, cellW, cellH, part.x, part.y, a.x, a.y, b.x, b.y, mask)
      : undefined;
    influences.push({
      id,
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      isPrimary: isBodyOrLimb ? /^(torso|body)$/i.test(id) : id === effectiveBoneId,
      isLeaf,
      geoDist,
    });
  }

  const limbRadius = 72;
  const limbCutoff = 145;
  const twoSigmaSq = 2 * limbRadius * limbRadius;

  for (let r = 0; r < rows; r++) {
    const vy = part.y + r * cellH;
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const vx = part.x + c * cellW;
      const rec: Record<string, number> = {};
      let totalW = 0;

      for (let i = 0; i < influences.length; i++) {
        const inf = influences[i];
        const d = inf.geoDist ? inf.geoDist[idx] : distToSegment(vx, vy, inf.ax, inf.ay, inf.bx, inf.by);
        let w = 0;
        if (inf.isPrimary) {
          w = Math.max(1e-5, Math.exp(-(d * d) / (2 * 145 * 145)));
        } else {
          // Uniform smooth capsule falloff (no directional step jump at wrist)
          const isHandL = /hand_l/i.test(inf.id);
          const cutoff = isHandL ? 260 : limbCutoff;
          const sigmaSq = isHandL ? 2 * 130 * 130 : twoSigmaSq;
          if (d < cutoff) {
            const fade = 1 - d / cutoff;
            w = Math.exp(-(d * d) / sigmaSq) * fade;
          }
        }
        if (w > 1e-4) {
          rec[inf.id] = w;
          totalW += w;
        }
      }

      if (totalW > 0) {
        for (const k of Object.keys(rec)) {
          rec[k] /= totalW;
        }
      }
      weights[idx] = rec;
    }
  }

  return { cols, rows, weights };
}

const autoWeightCache = new Map<string, VertexWeightMap>();

/**
 * Computes deformed mesh vertex positions (in world canvas coordinates)
 * using either custom painted weights or auto-generated capsule weights.
 */
export function solveSkinnedMeshVertices(
  character: Character,
  part: Part,
  solvedRig: SolvedRig,
  cols: number,
  rows: number
): Float32Array {
  const out = new Float32Array(cols * rows * 2);
  let weightMap =
    part.meshWeights && part.meshWeights.cols === cols && part.meshWeights.rows === rows
      ? part.meshWeights
      : undefined;

  if (!weightMap) {
    const boneSig = character.bones.map((b) => `${b.id}:${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.length)}`).join('|');
    const cacheKey = `${part.id}:${cols}x${rows}:${boneSig}`;
    weightMap = autoWeightCache.get(cacheKey);
    if (!weightMap) {
      weightMap = generateAutoWeights(character, part, solvedRig, cols, rows);
      if (autoWeightCache.size > 40) autoWeightCache.clear();
      autoWeightCache.set(cacheKey, weightMap);
    }
  }

  for (let r = 0; r < rows; r++) {
    const vy = part.y + (r / (rows - 1)) * part.h;
    for (let c = 0; c < cols; c++) {
      const vx = part.x + (c / (cols - 1)) * part.w;
      const idx = r * cols + c;
      const wRec = weightMap.weights[idx];

      let totalW = 0;
      let sumX = 0;
      let sumY = 0;

      if (wRec) {
        for (const [bId, w] of Object.entries(wRec)) {
          if (w <= 0) continue;
          const sb = solvedRig.bones.get(bId);
          if (!sb) continue;
          const p = transformPoint(sb.delta, vx, vy);
          sumX += p.x * w;
          sumY += p.y * w;
          totalW += w;
        }
      }

      const outIdx = idx * 2;
      out[outIdx] = totalW > 0 ? sumX / totalW : vx;
      out[outIdx + 1] = totalW > 0 ? sumY / totalW : vy;
    }
  }

  return out;
}
