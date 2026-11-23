import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { importPsdBuffer } from '../src/core/import/psdImporter';
import { mergePsdIntoProject } from '../src/core/import/psdMerge';
import { solveRig } from '../src/core/rig/rigSolver';
import { createPresetClip, evaluateCharacterAtTime } from '../src/core/anim/animEvaluator';

const PSD_PATH = '/Users/nice2mu/Downloads/va_char.psd';

describe('PSD Importer & Rig Solver', () => {
  it('imports va_char.psd cleanly with no pre-generated bones and solves manual bones', () => {
    const buf = fs.readFileSync(PSD_PATH);
    const res = importPsdBuffer(buf);

    expect(res.canvasWidth).toBe(3000);
    expect(res.canvasHeight).toBe(3000);
    expect(res.characters.map((c) => c.name)).toEqual(['Lumia', 'Marcia', 'Haqua', 'Akane']);

    const marcia = res.characters.find((c) => c.name === 'Marcia')!.character;
    expect(marcia.parts.length).toBeGreaterThanOrEqual(17);
    expect(marcia.bones.length).toBe(0);

    // Manually add a Head bone and bind 01_Head
    const headPart = marcia.parts.find((p) => p.name === '01_Head')!;
    marcia.bones.push({
      id: 'head',
      name: 'Head',
      parentId: null,
      x: 1458,
      y: 1380,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      length: 400,
      visualAngle: -90,
    });
    headPart.boneId = 'head';

    const restSolved = solveRig(marcia);
    const restHead = restSolved.parts.get(headPart.id)!;
    expect(restHead.worldMatrix.tx).toBeCloseTo(0, 4);
    expect(restHead.worldMatrix.ty).toBeCloseTo(0, 4);

    // Rotate head bone and verify neck pivot stays stationary
    const neckWorldBefore = restSolved.bones.get('head')!.worldPos;
    marcia.bones[0].rotation = 15;
    const rotatedSolved = solveRig(marcia);
    const neckWorldAfter = rotatedSolved.bones.get('head')!.worldPos;
    expect(neckWorldAfter.x).toBeCloseTo(neckWorldBefore.x, 4);
    expect(neckWorldAfter.y).toBeCloseTo(neckWorldBefore.y, 4);
    // Verify PartGroup locks parts across different z-orders together
    const hair1 = marcia.parts.find((p) => p.name === '01_Hair')!;
    const hair2 = marcia.parts.find((p) => p.name === '02_Hair')!;
    const hair3 = marcia.parts.find((p) => p.name === '03_Hair')!;
    const hair4 = marcia.parts.find((p) => p.name === '04_Hair')!;
    const origZs = [hair1.z, hair2.z, hair3.z, hair4.z];

    marcia.partGroups.push({
      id: 'grp_hair',
      name: 'Hair',
      boneId: 'head',
      pivot: { x: 1458, y: 1380 },
      visible: true,
    });
    hair1.groupId = 'grp_hair';
    hair2.groupId = 'grp_hair';
    hair3.groupId = 'grp_hair';
    hair4.groupId = 'grp_hair';

    const groupedSolved = solveRig(marcia);
    // All 4 hair parts get the exact same delta matrix from head bone
    const m1 = groupedSolved.parts.get(hair1.id)!.worldMatrix;
    const m2 = groupedSolved.parts.get(hair2.id)!.worldMatrix;
    const m3 = groupedSolved.parts.get(hair3.id)!.worldMatrix;
    const m4 = groupedSolved.parts.get(hair4.id)!.worldMatrix;
    expect(m1.a).toBeCloseTo(m2.a, 5);
    expect(m1.tx).toBeCloseTo(m3.tx, 5);
    expect(m1.ty).toBeCloseTo(m4.ty, 5);
    // z draw order is preserved
    expect([hair1.z, hair2.z, hair3.z, hair4.z]).toEqual(origZs);

    // Verify animation preset + evaluator
    const idleClip = createPresetClip('idle', marcia);
    expect(idleClip.tracks.length).toBeGreaterThan(0);
    const evalMid = evaluateCharacterAtTime(marcia, idleClip, 2.0);
    expect(evalMid.bones[0].rotation).toBeCloseTo(-2.0, 4);
  });

  it('merges updated PSD layers while preserving bones, groups, clips, and resampled meshWeights', () => {
    const buf = fs.readFileSync('/Users/nice2mu/Downloads/va_char.psd');
    const res = importPsdBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const marcia = res.characters.find((c) => c.name === 'Marcia')!.character;
    marcia.bones.push({ id: 'head', name: 'Head', parentId: null, x: 1500, y: 1400, rotation: 0, scaleX: 1, scaleY: 1, length: 400, visualAngle: -90 });
    const hair = marcia.parts.find((p) => p.name === '01_Hair')!;
    hair.skinned = true;
    hair.meshWeights = {
      cols: 2,
      rows: 2,
      weights: [
        { head: 1 },
        { head: 1 },
        { head: 0.5, ahoge: 0.5 },
        { head: 0.5, ahoge: 0.5 },
      ],
    };
    const origClip = createPresetClip('idle', marcia);
    marcia.clips = [origClip];

    const project = {
      version: 1 as const,
      name: 'va_char',
      activeCharacterId: marcia.id,
      characters: res.characters.map((c) => c.character),
    };

    // Simulate updated PSD where 01_Hair was cropped slightly and a new part was added
    const updatedEntries = res.characters.map((e) => {
      if (e.name !== 'Marcia') return e;
      const cloned = structuredClone(e.character);
      const h = cloned.parts.find((p) => p.name === '01_Hair')!;
      h.x += 10;
      h.w -= 20;
      cloned.parts.push({ ...h, id: 'part_new_ribbon', name: '01_Ribbon' });
      return { ...e, character: cloned };
    });

    const { project: merged, summary } = mergePsdIntoProject(project, updatedEntries, '/tmp/va_char.psd');
    const mergedMarcia = merged.characters.find((c) => c.name === 'Marcia')!;
    expect(merged.sourcePsdPath).toBe('/tmp/va_char.psd');
    expect(mergedMarcia.bones.length).toBe(1);
    expect(mergedMarcia.clips?.length).toBe(1);
    expect(summary.addedParts).toBe(1);
    const mergedHair = mergedMarcia.parts.find((p) => p.name === '01_Hair')!;
    expect(mergedHair.id).toBe(hair.id);
    expect(mergedHair.x).toBe(hair.x + 10);
    expect(mergedHair.meshWeights?.weights[0].head).toBeCloseTo(1, 5);
  });
});
