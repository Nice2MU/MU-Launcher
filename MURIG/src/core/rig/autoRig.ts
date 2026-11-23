import { Character, ImportWarning, Param, Part } from '../model/types';
import type { RawLayerPart } from '../import/psdImporter';

export function buildAutoRig(
  name: string,
  canvasWidth: number,
  canvasHeight: number,
  parts: Part[],
  _rawLayers: RawLayerPart[],
  warnings: ImportWarning[]
): Character {
  for (const part of parts) {
    part.boneId = '';
    part.skinned = false;
    part.parallax = /eye|eyebrow|mouth|02_hair/i.test(part.name)
      ? 0.55
      : /cheek/i.test(part.name)
        ? 0.35
        : /01_hair/i.test(part.name)
          ? 0.2
          : 0;
  }

  const params: Param[] = [];
  const lEyes = parts.filter((p) => /^L_.*eye/i.test(p.name) && !/eyebrow/i.test(p.name));
  const rEyes = parts.filter((p) => /^R_.*eye/i.test(p.name) && !/eyebrow/i.test(p.name));
  const mouths = parts.filter((p) => /mouth/i.test(p.name));

  if (lEyes.length > 0) {
    params.push({
      id: 'EyeOpenL',
      name: 'Eye Open L',
      min: 0,
      max: 1,
      defaultValue: 1,
      value: 1,
      bindings: lEyes.map((e) => ({
        targetType: 'part',
        targetId: e.id,
        prop: 'scaleY',
        keys: [{ param: 0, value: 0.05 }, { param: 1, value: 1 }],
      })),
    });
  }
  if (rEyes.length > 0) {
    params.push({
      id: 'EyeOpenR',
      name: 'Eye Open R',
      min: 0,
      max: 1,
      defaultValue: 1,
      value: 1,
      bindings: rEyes.map((e) => ({
        targetType: 'part',
        targetId: e.id,
        prop: 'scaleY',
        keys: [{ param: 0, value: 0.05 }, { param: 1, value: 1 }],
      })),
    });
  }
  if (mouths.length > 0) {
    params.push({
      id: 'MouthOpen',
      name: 'Mouth Open',
      min: -1,
      max: 1,
      defaultValue: 0,
      value: 0,
      bindings: mouths.map((m) => ({
        targetType: 'part',
        targetId: m.id,
        prop: 'scaleY',
        keys: [{ param: -1, value: 0.45 }, { param: 0, value: 1 }, { param: 1, value: 1.45 }],
      })),
    });
  }
  const brows = parts.filter((p) => /eyebrow|brow/i.test(p.name));
  if (brows.length > 0) {
    params.push({
      id: 'BrowY',
      name: 'Brow Y',
      min: -1,
      max: 1,
      defaultValue: 0,
      value: 0,
      bindings: brows.map((b) => ({
        targetType: 'part',
        targetId: b.id,
        prop: 'y',
        keys: [{ param: -1, value: 8 }, { param: 1, value: -8 }],
      })),
    });
  }

  return {
    id: `char_${name.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
    name,
    canvasWidth,
    canvasHeight,
    bones: [],
    parts,
    partGroups: [],
    params,
    clips: [],
    warnings,
  };
}
