import { describe, expect, it } from 'vitest';
import { writePsdBuffer } from 'ag-psd';
import { importPsdBuffer } from '../src/core/import/psdImporter';
import { mergePsdIntoProject } from '../src/core/import/psdMerge';

function makeLeaf(name: string, left: number, top: number, w = 20, h = 20) {
  return {
    name,
    left,
    top,
    right: left + w,
    bottom: top + h,
    imageData: {
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4).fill(255),
    },
  };
}

describe('PSD Hierarchy Importer', () => {
  it('unwraps Category -> Character -> Variant folders (e.g. Char/Akane/001aka-n)', () => {
    const psdBytes = writePsdBuffer({
      width: 512,
      height: 512,
      children: [
        {
          name: 'Char',
          children: [
            {
              name: 'Akane',
              children: [
                {
                  name: '001aka-n',
                  children: [
                    makeLeaf('Body', 100, 100, 40, 60),
                    {
                      name: 'Face',
                      children: [makeLeaf('Eye_L', 120, 120, 10, 10)],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          name: 'NPC',
          children: [
            {
              name: 'Haqua',
              hidden: true,
              children: [
                {
                  name: 'haqua-n',
                  children: [
                    {
                      name: 'Head',
                      children: [makeLeaf('Hair', 80, 60, 40, 40)],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    const result = importPsdBuffer(psdBytes);
    expect(result.characters.map((c) => c.name)).toEqual(['001aka-n', 'haqua-n']);
    expect(result.characters[0].hidden).toBe(false);
    expect(result.characters[0].layerCount).toBe(2);
    expect(result.characters[1].hidden).toBe(true);
    expect(result.characters[1].layerCount).toBe(1);
  });

  it('still supports 2-level Category -> Character folders (e.g. NPC/Marcia)', () => {
    const psdBytes = writePsdBuffer({
      width: 512,
      height: 512,
      children: [
        {
          name: 'NPC',
          children: [
            {
              name: 'Marcia',
              children: [
                makeLeaf('01_Body', 50, 50, 50, 80),
              ],
            },
          ],
        },
      ],
    });

    const result = importPsdBuffer(psdBytes);
    expect(result.characters.map((c) => c.name)).toEqual(['Marcia']);
    expect(result.characters[0].layerCount).toBe(1);
  });

  it('migrates old character names (e.g. Marcia -> marcia-n) on Update PSD while preserving bones & clips', () => {
    const psdBytes = writePsdBuffer({
      width: 512,
      height: 512,
      children: [
        {
          name: 'NPC',
          children: [
            {
              name: 'Marcia',
              children: [
                {
                  name: 'marcia-n',
                  children: [makeLeaf('01_Body', 50, 50, 50, 80)],
                },
              ],
            },
          ],
        },
      ],
    });

    const imported = importPsdBuffer(psdBytes);
    const oldProject = {
      version: 1,
      name: 'asset-char',
      activeCharacterId: 'char_marcia',
      characters: [
        {
          id: 'char_marcia',
          name: 'Marcia',
          canvasWidth: 512,
          canvasHeight: 512,
          bones: [
            {
              id: 'b_root',
              name: 'Root',
              parentId: null,
              x: 100,
              y: 100,
              rotation: 0,
              scaleX: 1,
              scaleY: 1,
              length: 50,
              visualAngle: -90,
            },
          ],
          parts: [
            {
              id: 'p1',
              name: '01_Body',
              boneId: 'b_root',
              imageDataUrl: '',
              x: 50,
              y: 50,
              w: 50,
              h: 80,
              pivot: { x: 75, y: 90 },
              z: 0,
              visible: true,
              alpha: 1,
              parallax: 0,
            },
          ],
          partGroups: [],
          params: [],
          clips: [{ id: 'clip_1', name: 'Idle', duration: 2, loop: true, tracks: [] }],
          warnings: [],
        },
      ],
    };

    const { project: merged, summary } = mergePsdIntoProject(oldProject, imported.characters);
    expect(summary.updatedParts).toBe(1);
    expect(summary.addedCharacters).toBe(0);
    expect(merged.characters.length).toBe(1);
    expect(merged.characters[0].name).toBe('marcia-n');
    expect(merged.characters[0].bones.length).toBe(1);
    expect(merged.characters[0].clips.length).toBe(1);
  });
});
