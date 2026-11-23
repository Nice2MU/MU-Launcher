import { AnimClip, AnimTrack, Character, EaseType, Keyframe } from '../model/types';

function applyEase(t: number, ease: EaseType): number {
  switch (ease) {
    case 'step':
      return 0;
    case 'easeIn':
      return t * t;
    case 'easeOut':
      return 1 - (1 - t) * (1 - t);
    case 'easeInOut':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'linear':
    default:
      return t;
  }
}

export function evaluateKeyframes(keys: Keyframe[], time: number): number | null {
  if (keys.length === 0) return null;
  if (keys.length === 1) return keys[0].v;

  const sorted = [...keys].sort((a, b) => a.t - b.t);
  if (time <= sorted[0].t) return sorted[0].v;
  if (time >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].v;

  for (let i = 0; i < sorted.length - 1; i++) {
    const k0 = sorted[i];
    const k1 = sorted[i + 1];
    if (time >= k0.t && time <= k1.t) {
      const span = k1.t - k0.t;
      if (span <= 1e-6) return k0.v;
      const rawT = (time - k0.t) / span;
      const easedT = applyEase(rawT, k0.ease);
      return k0.v + (k1.v - k0.v) * easedT;
    }
  }
  return sorted[0].v;
}

/**
 * Returns a lightweight evaluated Character view at `time` without mutating the source Character.
 */
export function evaluateCharacterAtTime(
  character: Character,
  clip: AnimClip | undefined,
  time: number
): Character {
  if (!clip || clip.tracks.length === 0) return character;

  const t =
    clip.duration > 0
      ? clip.loop
        ? ((time % clip.duration) + clip.duration) % clip.duration
        : Math.max(0, Math.min(clip.duration, time))
      : 0;

  const boneOverrides = new Map<string, Record<string, number>>();
  const paramOverrides = new Map<string, number>();

  for (const track of clip.tracks) {
    const val = evaluateKeyframes(track.keys, t);
    if (val === null) continue;
    if (track.targetType === 'bone') {
      let rec = boneOverrides.get(track.targetId);
      if (!rec) {
        rec = {};
        boneOverrides.set(track.targetId, rec);
      }
      rec[track.prop] = val;
    } else {
      paramOverrides.set(track.targetId, val);
    }
  }

  return {
    ...character,
    bones: character.bones.map((b) => {
      const ov = boneOverrides.get(b.id);
      return ov ? { ...b, ...ov } : b;
    }),
    params: character.params.map((p) => {
      const ov = paramOverrides.get(p.id);
      return ov !== undefined ? { ...p, value: ov } : p;
    }),
  };
}

function findBoneByPattern(character: Character, regex: RegExp) {
  return character.bones.find((b) => regex.test(b.id) || regex.test(b.name));
}

export function createPresetClip(
  preset: 'idle' | 'wave' | 'nod',
  character: Character
): AnimClip {
  const torso = findBoneByPattern(character, /^(torso|body)$/i);
  const head = findBoneByPattern(character, /^head$/i);
  const neck = findBoneByPattern(character, /^neck$/i);
  const armL = findBoneByPattern(character, /upper_?arm_l|arm_l/i);
  const forearmL = findBoneByPattern(character, /forearm_l/i);
  const armR = findBoneByPattern(character, /upper_?arm_r|arm_r/i);
  const forearmR = findBoneByPattern(character, /forearm_r/i);

  const thighL = findBoneByPattern(character, /thigh_l/i);
  const shinL = findBoneByPattern(character, /shin_l/i);
  const thighR = findBoneByPattern(character, /thigh_r/i);
  const shinR = findBoneByPattern(character, /shin_r/i);
  const hairFront = findBoneByPattern(character, /hair_front/i);
  const hairBackL = findBoneByPattern(character, /hair_back_l/i);
  const hairBackR = findBoneByPattern(character, /hair_back_r/i);
  const hood = findBoneByPattern(character, /^hood$/i);
  const backpack = findBoneByPattern(character, /^backpack$/i);

  const tracks: AnimTrack[] = [];
  const pushTrack = (
    targetId: string | undefined,
    prop: AnimTrack['prop'],
    keys: Keyframe[],
    targetType: 'bone' | 'param' = 'bone'
  ) => {
    if (!targetId) return;
    tracks.push({
      id: `trk_${targetId}_${prop}_${Math.random().toString(36).slice(2, 6)}`,
      targetType,
      targetId,
      prop,
      keys,
    });
  };

  if (preset === 'idle') {
    const d = 3.2;
    // Overlapping action: Torso leads, Neck/Head & Hair/Hood lag behind for natural flow
    if (torso) {
      pushTrack(torso.id, 'rotation', [
        { t: 0, v: -1.0, ease: 'easeInOut' },
        { t: 1.6, v: 1.1, ease: 'easeInOut' },
        { t: d, v: -1.0, ease: 'easeInOut' },
      ]);
    }
    if (neck) {
      pushTrack(neck.id, 'rotation', [
        { t: 0, v: -0.6, ease: 'easeInOut' },
        { t: 0.3, v: -0.9, ease: 'easeInOut' },
        { t: 1.9, v: 1.2, ease: 'easeInOut' },
        { t: d, v: -0.6, ease: 'easeInOut' },
      ]);
    }
    if (head) {
      pushTrack(head.id, 'rotation', [
        { t: 0, v: 1.2, ease: 'easeInOut' },
        { t: 0.4, v: 1.6, ease: 'easeInOut' },
        { t: 2.0, v: -2.0, ease: 'easeInOut' },
        { t: d, v: 1.2, ease: 'easeInOut' },
      ]);
    }
    if (armL) {
      pushTrack(armL.id, 'rotation', [
        { t: 0, v: 2.5, ease: 'easeInOut' },
        { t: 0.3, v: 3.5, ease: 'easeInOut' },
        { t: 1.8, v: -4.5, ease: 'easeInOut' },
        { t: d, v: 2.5, ease: 'easeInOut' },
      ]);
    }
    if (forearmL) {
      pushTrack(forearmL.id, 'rotation', [
        { t: 0, v: -3.0, ease: 'easeInOut' },
        { t: 0.5, v: -4.5, ease: 'easeInOut' },
        { t: 2.0, v: 5.5, ease: 'easeInOut' },
        { t: d, v: -3.0, ease: 'easeInOut' },
      ]);
    }
    if (armR) {
      pushTrack(armR.id, 'rotation', [
        { t: 0, v: -2.5, ease: 'easeInOut' },
        { t: 0.35, v: -3.5, ease: 'easeInOut' },
        { t: 1.85, v: 4.5, ease: 'easeInOut' },
        { t: d, v: -2.5, ease: 'easeInOut' },
      ]);
    }
    if (forearmR) {
      pushTrack(forearmR.id, 'rotation', [
        { t: 0, v: 3.0, ease: 'easeInOut' },
        { t: 0.5, v: 4.0, ease: 'easeInOut' },
        { t: 2.0, v: -5.0, ease: 'easeInOut' },
        { t: d, v: 3.0, ease: 'easeInOut' },
      ]);
    }
    // Subtle leg weight shift / knee flex
    if (thighL) {
      pushTrack(thighL.id, 'rotation', [
        { t: 0, v: -1.8, ease: 'easeInOut' },
        { t: 1.6, v: 2.2, ease: 'easeInOut' },
        { t: d, v: -1.8, ease: 'easeInOut' },
      ]);
    }
    if (shinL) {
      pushTrack(shinL.id, 'rotation', [
        { t: 0, v: 2.2, ease: 'easeInOut' },
        { t: 1.6, v: -2.8, ease: 'easeInOut' },
        { t: d, v: 2.2, ease: 'easeInOut' },
      ]);
    }
    if (thighR) {
      pushTrack(thighR.id, 'rotation', [
        { t: 0, v: 1.8, ease: 'easeInOut' },
        { t: 1.6, v: -2.2, ease: 'easeInOut' },
        { t: d, v: 1.8, ease: 'easeInOut' },
      ]);
    }
    if (shinR) {
      pushTrack(shinR.id, 'rotation', [
        { t: 0, v: -2.2, ease: 'easeInOut' },
        { t: 1.6, v: 2.8, ease: 'easeInOut' },
        { t: d, v: -2.2, ease: 'easeInOut' },
      ]);
    }
    if (hairFront) {
      pushTrack(hairFront.id, 'rotation', [
        { t: 0, v: -1.2, ease: 'easeInOut' },
        { t: 0.5, v: -2.0, ease: 'easeInOut' },
        { t: 2.1, v: 2.2, ease: 'easeInOut' },
        { t: d, v: -1.2, ease: 'easeInOut' },
      ]);
    }
    if (hairBackL) {
      pushTrack(hairBackL.id, 'rotation', [
        { t: 0, v: -1.8, ease: 'easeInOut' },
        { t: 0.5, v: -2.5, ease: 'easeInOut' },
        { t: 2.1, v: 2.8, ease: 'easeInOut' },
        { t: d, v: -1.8, ease: 'easeInOut' },
      ]);
    }
    if (hairBackR) {
      pushTrack(hairBackR.id, 'rotation', [
        { t: 0, v: -1.8, ease: 'easeInOut' },
        { t: 0.5, v: -2.5, ease: 'easeInOut' },
        { t: 2.1, v: 2.8, ease: 'easeInOut' },
        { t: d, v: -1.8, ease: 'easeInOut' },
      ]);
    }
    if (hood) {
      pushTrack(hood.id, 'rotation', [
        { t: 0, v: 1.0, ease: 'easeInOut' },
        { t: 0.4, v: 1.4, ease: 'easeInOut' },
        { t: 2.0, v: -1.6, ease: 'easeInOut' },
        { t: d, v: 1.0, ease: 'easeInOut' },
      ]);
    }
    if (backpack) {
      pushTrack(backpack.id, 'rotation', [
        { t: 0, v: -1.0, ease: 'easeInOut' },
        { t: 0.4, v: -1.4, ease: 'easeInOut' },
        { t: 2.0, v: 1.6, ease: 'easeInOut' },
        { t: d, v: -1.0, ease: 'easeInOut' },
      ]);
    }
    // Natural Eye Blink
    if (character.params.some((p) => p.id === 'EyeOpenL')) {
      pushTrack('EyeOpenL', 'value', [
        { t: 0, v: 1, ease: 'linear' },
        { t: 2.1, v: 1, ease: 'easeInOut' },
        { t: 2.2, v: 0, ease: 'easeInOut' },
        { t: 2.34, v: 1, ease: 'linear' },
        { t: d, v: 1, ease: 'linear' },
      ], 'param');
    }
    if (character.params.some((p) => p.id === 'EyeOpenR')) {
      pushTrack('EyeOpenR', 'value', [
        { t: 0, v: 1, ease: 'linear' },
        { t: 2.1, v: 1, ease: 'easeInOut' },
        { t: 2.2, v: 0, ease: 'easeInOut' },
        { t: 2.34, v: 1, ease: 'linear' },
        { t: d, v: 1, ease: 'linear' },
      ], 'param');
    }
    return {
      id: `clip_idle_${Date.now().toString(36)}`,
      name: 'idle',
      duration: d,
      fps: 30,
      loop: true,
      tracks,
    };
  }

  if (preset === 'wave') {
    const d = 1.6;
    if (torso) {
      pushTrack(torso.id, 'rotation', [
        { t: 0, v: -3, ease: 'easeInOut' },
        { t: d * 0.5, v: 3, ease: 'easeInOut' },
        { t: d, v: -3, ease: 'easeInOut' },
      ]);
    }
    if (head) {
      pushTrack(head.id, 'rotation', [
        { t: 0, v: -4, ease: 'easeInOut' },
        { t: d * 0.5, v: 4, ease: 'easeInOut' },
        { t: d, v: -4, ease: 'easeInOut' },
      ]);
    }
    if (armL) {
      pushTrack(armL.id, 'rotation', [
        { t: 0, v: -8, ease: 'easeInOut' },
        { t: d * 0.5, v: 6, ease: 'easeInOut' },
        { t: d, v: -8, ease: 'easeInOut' },
      ]);
    }
    if (forearmL) {
      pushTrack(forearmL.id, 'rotation', [
        { t: 0, v: -14, ease: 'easeInOut' },
        { t: d * 0.25, v: 12, ease: 'easeInOut' },
        { t: d * 0.5, v: -14, ease: 'easeInOut' },
        { t: d * 0.75, v: 12, ease: 'easeInOut' },
        { t: d, v: -14, ease: 'easeInOut' },
      ]);
    }
    if (forearmR) {
      pushTrack(forearmR.id, 'rotation', [
        { t: 0, v: 8, ease: 'easeInOut' },
        { t: d * 0.5, v: -8, ease: 'easeInOut' },
        { t: d, v: 8, ease: 'easeInOut' },
      ]);
    }
    return {
      id: `clip_wave_${Date.now().toString(36)}`,
      name: 'wave',
      duration: d,
      fps: 30,
      loop: true,
      tracks,
    };
  }

  // nod
  const d = 1.2;
  if (neck) {
    pushTrack(neck.id, 'rotation', [
      { t: 0, v: 0, ease: 'easeInOut' },
      { t: 0.3, v: 6, ease: 'easeInOut' },
      { t: 0.6, v: 0, ease: 'easeInOut' },
      { t: 0.9, v: 5, ease: 'easeInOut' },
      { t: d, v: 0, ease: 'easeInOut' },
    ]);
  }
  if (head) {
    pushTrack(head.id, 'y', [
      { t: 0, v: head.y, ease: 'easeInOut' },
      { t: 0.3, v: head.y + 18, ease: 'easeInOut' },
      { t: 0.6, v: head.y, ease: 'easeInOut' },
      { t: 0.9, v: head.y + 14, ease: 'easeInOut' },
      { t: d, v: head.y, ease: 'easeInOut' },
    ]);
  }
  return {
    id: `clip_nod_${Date.now().toString(36)}`,
    name: 'nod',
    duration: d,
    fps: 30,
    loop: true,
    tracks,
  };
}
