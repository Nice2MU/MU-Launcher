import { describe, expect, it } from 'vitest';
import {
  buildUnityAtlasText,
  buildUnityRigExport,
  packAtlasRegions,
} from '../src/core/export/unityExport';
import { Character } from '../src/core/model/types';

const samplePngB64 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVQI12NgAAIAAAUAAeImBZsAAAAASUVORK5CYII=';

function makeCharacter(): Character {
  return {
    id: 'char_marcia',
    name: 'Marcia',
    canvasWidth: 3000,
    canvasHeight: 3000,
    bones: [
      {
        id: 'root',
        name: 'Root',
        parentId: null,
        x: 1500,
        y: 2000,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        length: 70,
        visualAngle: -90,
      },
    ],
    parts: [
      {
        id: 'p1',
        name: '01_Body',
        boneId: 'root',
        imageDataUrl: samplePngB64,
        x: 500,
        y: 400,
        w: 400,
        h: 600,
        pivot: { x: 200, y: 300 },
        z: 0,
        visible: true,
        alpha: 1,
        parallax: 0,
        skinned: true,
        meshWeights: {
          cols: 2,
          rows: 2,
          weights: [{ root: 1 }, { root: 1 }, { root: 1 }, { root: 1 }],
        },
      },
      {
        id: 'p2',
        name: '02_Head',
        boneId: 'root',
        imageDataUrl: samplePngB64,
        x: 550,
        y: 120,
        w: 250,
        h: 280,
        pivot: { x: 125, y: 140 },
        z: 1,
        visible: true,
        alpha: 1,
        parallax: 0,
      },
      {
        id: 'p3',
        name: '03_Hidden',
        boneId: 'root',
        imageDataUrl: samplePngB64,
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        pivot: { x: 5, y: 5 },
        z: 2,
        visible: false,
        alpha: 1,
        parallax: 0,
      },
    ],
    partGroups: [],
    params: [],
    clips: [],
    warnings: [],
  };
}

describe('Unity Rig Export', () => {
  it('packs selected parts into a non-overlapping Texture Atlas at 1:1 original dimensions', () => {
    const ch = makeCharacter();
    const pack = packAtlasRegions(ch.parts.slice(0, 2), 4);

    expect(pack.regions.length).toBe(2);
    expect(pack.regions[0].w).toBe(400);
    expect(pack.regions[0].h).toBe(600);
    expect(pack.regions[1].w).toBe(250);
    expect(pack.regions[1].h).toBe(280);

    const [a, b] = pack.regions;
    const overlaps =
      a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    expect(overlaps).toBe(false);
    expect(pack.atlasWidth).toBeGreaterThanOrEqual(408);
    expect(pack.atlasHeight).toBeGreaterThanOrEqual(608);
  });

  it('builds Spine-compatible .atlas and atlas-mode .rig.json by default', () => {
    const ch = makeCharacter();
    const bundle = buildUnityRigExport(ch, {
      exportName: 'Marcia_Export',
      selectedPartIds: ['p1', 'p2'],
    });

    expect(bundle.atlasMode).toBe(true);
    expect(bundle.textures.length).toBe(0);
    expect(bundle.atlasText).toContain('Marcia_Export.png');
    expect(bundle.atlasText).toContain(`size: ${bundle.atlasWidth}, ${bundle.atlasHeight}`);
    expect(bundle.atlasText).toContain('01_Body\n  rotate: false');
    expect(bundle.atlasText).toContain('  size: 400, 600');
    expect(bundle.atlasText).toContain('  orig: 400, 600');

    const parsed = JSON.parse(bundle.rigJson);
    expect(parsed.atlasTexture).toBe('Marcia_Export.png');
    expect(parsed.atlasFile).toBe('Marcia_Export.atlas');
    expect(parsed.parts.length).toBe(2);
    expect(parsed.parts[0].regionName).toBe('01_Body');
    expect(parsed.parts[0].atlasRect).toMatchObject({ w: 400, h: 600 });
    expect(parsed.parts[0].uv.u1).toBeGreaterThan(parsed.parts[0].uv.u0);
    expect(parsed.parts[0].imageDataUrl).toBeUndefined();
    expect(parsed.parts[0].meshWeights).toBeDefined();

    // Direct helper check
    const rawAtlas = buildUnityAtlasText('test.png', 512, 512, bundle.regions);
    expect(rawAtlas).toContain('test.png\nsize: 512, 512');
  });

  it('supports loose per-part PNG export when atlasMode is false', () => {
    const ch = makeCharacter();
    const bundle = buildUnityRigExport(ch, {
      exportName: 'Marcia_Loose',
      selectedPartIds: ['p1'],
      atlasMode: false,
    });

    expect(bundle.atlasMode).toBe(false);
    expect(bundle.textures.length).toBe(1);
    expect(bundle.textures[0].fileName).toBe('01_Body.png');
    const parsed = JSON.parse(bundle.rigJson);
    expect(parsed.parts[0].texture).toBe('textures/01_Body.png');
  });
});
