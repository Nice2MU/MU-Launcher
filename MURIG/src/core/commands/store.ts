import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { AnimClip, AnimProp, Bone, Character, EaseType, EditorMode, MurigProject, Part, PartGroup, RigTool } from '../model/types';
import { createPresetClip } from '../anim/animEvaluator';
import { computePartTiltDegFromDataUrl, isEyePartName } from '../rig/eyeTilt';
import { generateAutoWeights, solveRig } from '../rig/rigSolver';
import type { PsdCharacterEntry } from '../import/psdImporter';
import { mergePsdIntoProject, PsdMergeSummary } from '../import/psdMerge';

const MAX_HISTORY = 50;

interface MurigState {
  project: MurigProject | null;
  currentProjectPath: string | null;
  selectedBoneId: string | null;
  selectedPartId: string | null;
  selectedPartIds: string[];
  selectedGroupId: string | null;
  mode: EditorMode;
  rigTool: RigTool;
  brushSize: number;
  brushStrength: number;
  brushMode: 'add' | 'erase';
  showBones: boolean;
  showParts: boolean;
  activeClipId: string | null;
  currentTime: number;
  isPlaying: boolean;
  autoKey: boolean;
  past: MurigProject[];
  future: MurigProject[];

  loadFromPsdEntries: (fileName: string, entries: PsdCharacterEntry[], sourcePsdPath?: string) => void;
  updateFromPsdEntries: (entries: PsdCharacterEntry[], sourcePsdPath?: string) => PsdMergeSummary | null;
  loadProject: (project: MurigProject, filePath?: string | null) => void;
  closeProject: () => void;
  setCurrentProjectPath: (path: string | null) => void;
  selectCharacter: (characterId: string) => void;
  selectBone: (boneId: string | null) => void;
  selectPart: (partId: string | null, multi?: boolean) => void;
  selectGroup: (groupId: string | null) => void;
  setMode: (mode: EditorMode) => void;
  setRigTool: (tool: RigTool) => void;
  setBrushSize: (size: number) => void;
  setBrushStrength: (strength: number) => void;
  setBrushMode: (mode: 'add' | 'erase') => void;
  initAutoWeights: (partId?: string) => void;
  paintWeightsAt: (
    worldX: number,
    worldY: number,
    boneId: string,
    radius: number,
    strength: number,
    erase?: boolean,
    recordUndo?: boolean
  ) => void;
  setShowBones: (show: boolean) => void;
  setShowParts: (show: boolean) => void;

  commitSnapshot: (snapshot: MurigProject) => void;
  updateBone: (boneId: string, patch: Partial<Bone>, recordUndo?: boolean) => void;
  addBone: (parentId: string | null, opts?: Partial<Bone>) => string | null;
  deleteBone: (boneId: string) => void;
  clearBones: () => void;
  updatePart: (partId: string, patch: Partial<Part>, recordUndo?: boolean) => void;
  createPartGroup: (name: string, partIds?: string[], boneId?: string) => string | null;
  updatePartGroup: (groupId: string, patch: Partial<PartGroup>, recordUndo?: boolean) => void;
  deletePartGroup: (groupId: string) => void;
  assignPartsToGroup: (partIds: string[], groupId: string | null) => void;
  setParamValue: (paramId: string, value: number) => void;
  resetPose: () => void;

  createClip: (name?: string, duration?: number, loop?: boolean) => string | null;
  selectClip: (clipId: string | null) => void;
  deleteClip: (clipId: string) => void;
  updateClip: (clipId: string, patch: Partial<AnimClip>) => void;
  setCurrentTime: (t: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setAutoKey: (autoKey: boolean) => void;
  setKeyframe: (
    targetType: 'bone' | 'param',
    targetId: string,
    prop: AnimProp | 'value',
    value: number,
    time?: number,
    ease?: EaseType
  ) => void;
  deleteKeyframe: (trackId: string, time: number) => void;
  keyCurrentPose: () => void;
  applyAnimPreset: (preset: 'idle' | 'wave' | 'nod') => string | null;

  undo: () => void;
  redo: () => void;
}

function getActiveChar(project: MurigProject | null): Character | undefined {
  if (!project) return undefined;
  return project.characters.find((c) => c.id === project.activeCharacterId) ?? project.characters[0];
}

function pushPast(state: MurigState, snapshot: MurigProject) {
  state.past.push(snapshot);
  if (state.past.length > MAX_HISTORY) state.past.shift();
  state.future = [];
}

function hydrateEyeTiltAngles(project: MurigProject) {
  for (const ch of project.characters) {
    for (const p of ch.parts) {
      if (isEyePartName(p.name) && p.scaleAngle === undefined && p.imageDataUrl) {
        void computePartTiltDegFromDataUrl(p.imageDataUrl).then((deg) => {
          if (Math.abs(deg) < 0.5) return;
          useMurigStore.setState((s) => {
            const targetCh = s.project?.characters.find((c) => c.id === ch.id);
            const targetPart = targetCh?.parts.find((pt) => pt.id === p.id);
            if (targetPart && targetPart.scaleAngle === undefined) {
              targetPart.scaleAngle = deg;
            }
          });
        });
      }
    }
  }
}

export const useMurigStore = create<MurigState>()(
  immer((set, get) => ({
    project: null,
    currentProjectPath: null,
    selectedBoneId: null,
    selectedPartId: null,
    selectedPartIds: [],
    selectedGroupId: null,
    mode: 'rig',
    rigTool: 'select',
    brushSize: 130,
    brushStrength: 0.7,
    brushMode: 'add',
    showBones: true,
    showParts: true,
    activeClipId: null,
    currentTime: 0,
    isPlaying: false,
    autoKey: true,
    past: [],
    future: [],

    loadFromPsdEntries: (fileName, entries, sourcePsdPath) => {
      if (entries.length === 0) return;
      // Prefer the first visible character (e.g. Marcia in va_char.psd)
      const defaultEntry = entries.find((e) => !e.hidden) ?? entries[0];
      const project: MurigProject = {
        version: 1,
        name: fileName.replace(/\.psd$/i, ''),
        sourcePsdPath,
        activeCharacterId: defaultEntry.character.id,
        characters: entries.map((e) => e.character),
      };
      set((state) => {
        state.project = project;
        state.currentProjectPath = null;
        state.selectedBoneId = defaultEntry.character.bones[1]?.id ?? defaultEntry.character.bones[0]?.id ?? null;
        state.selectedPartId = null;
        state.past = [];
        state.future = [];
      });
      hydrateEyeTiltAngles(project);
    },

    updateFromPsdEntries: (entries, sourcePsdPath) => {
      const prev = get().project;
      if (!prev || entries.length === 0) return null;
      const { project: merged, summary } = mergePsdIntoProject(prev, entries, sourcePsdPath);
      set((state) => {
        state.project = merged;
        pushPast(state, prev);
      });
      hydrateEyeTiltAngles(merged);
      return summary;
    },

    loadProject: (project, filePath = null) => {
      set((state) => {
        state.project = project;
        state.currentProjectPath = filePath;
        const ch = getActiveChar(project);
        state.selectedBoneId = ch?.bones[0]?.id ?? null;
        state.selectedPartId = null;
        state.past = [];
        state.future = [];
      });
      hydrateEyeTiltAngles(project);
    },

    closeProject: () => {
      set((state) => {
        state.project = null;
        state.currentProjectPath = null;
        state.selectedBoneId = null;
        state.selectedPartId = null;
        state.selectedPartIds = [];
        state.selectedGroupId = null;
        state.mode = 'rig';
        state.rigTool = 'select';
        state.activeClipId = null;
        state.currentTime = 0;
        state.isPlaying = false;
        state.past = [];
        state.future = [];
      });
    },

    setCurrentProjectPath: (currentProjectPath) => set({ currentProjectPath }),

    selectCharacter: (characterId) => {
      set((state) => {
        if (!state.project) return;
        state.project.activeCharacterId = characterId;
        const ch = getActiveChar(state.project);
        state.selectedBoneId = ch?.bones[1]?.id ?? ch?.bones[0]?.id ?? null;
        state.selectedPartId = null;
      });
    },

    selectBone: (boneId) => {
      set((state) => {
        state.selectedBoneId = boneId;
        if (boneId) {
          state.selectedPartId = null;
          state.selectedPartIds = [];
          state.selectedGroupId = null;
        }
      });
    },

    selectPart: (partId, multi = false) => {
      set((state) => {
        state.selectedBoneId = null;
        state.selectedGroupId = null;
        if (!partId) {
          state.selectedPartId = null;
          state.selectedPartIds = [];
          return;
        }
        if (multi) {
          const exists = state.selectedPartIds.includes(partId);
          if (exists) {
            state.selectedPartIds = state.selectedPartIds.filter((id) => id !== partId);
          } else {
            state.selectedPartIds.push(partId);
          }
          state.selectedPartId = state.selectedPartIds[state.selectedPartIds.length - 1] ?? null;
        } else {
          state.selectedPartId = partId;
          state.selectedPartIds = [partId];
        }
      });
    },

    selectGroup: (groupId) => {
      set((state) => {
        state.selectedGroupId = groupId;
        if (groupId) {
          state.selectedBoneId = null;
          state.selectedPartId = null;
          state.selectedPartIds = [];
        }
      });
    },

    setMode: (mode) => set({ mode }),
    setRigTool: (rigTool) => set({ rigTool }),
    setBrushSize: (brushSize) => set({ brushSize }),
    setBrushStrength: (brushStrength) => set({ brushStrength }),
    setBrushMode: (brushMode) => set({ brushMode }),

    initAutoWeights: (partId) => {
      const prev = get().project;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch) return;
        const solved = solveRig(ch);
        const groupMap = new Map((ch.partGroups ?? []).map((g) => [g.id, g]));
        for (const p of ch.parts) {
          if (partId && p.id !== partId) continue;
          const grp = p.groupId ? groupMap.get(p.groupId) : undefined;
          const isSkinned = Boolean(grp?.skinned !== undefined ? grp.skinned : p.skinned);
          if (!isSkinned && !partId) continue;
          p.skinned = true;
          p.meshWeights = generateAutoWeights(ch, p, solved, 32, 32);
        }
        if (prev) pushPast(state, prev);
      });
    },

    paintWeightsAt: (worldX, worldY, boneId, radius, strength, erase = false, recordUndo = false) => {
      const prev = recordUndo ? get().project : null;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch || !boneId) return;
        const solved = solveRig(ch);
        const groupMap = new Map((ch.partGroups ?? []).map((g) => [g.id, g]));
        const fallbackBone = ch.bones.find((b) => /^(torso|body)$/i.test(b.id))?.id ?? ch.bones[0]?.id ?? '';

        for (const p of ch.parts) {
          const grp = p.groupId ? groupMap.get(p.groupId) : undefined;
          const isSkinned = Boolean(grp?.skinned !== undefined ? grp.skinned : p.skinned);
          if (!isSkinned) continue;

          // Quick bounds check
          if (
            worldX < p.x - radius ||
            worldX > p.x + p.w + radius ||
            worldY < p.y - radius ||
            worldY > p.y + p.h + radius
          ) {
            continue;
          }

          if (!p.meshWeights || p.meshWeights.cols !== 32 || p.meshWeights.rows !== 32) {
            p.meshWeights = generateAutoWeights(ch, p, solved, 32, 32);
          }

          const { cols, rows, weights } = p.meshWeights;
          for (let r = 0; r < rows; r++) {
            const vy = p.y + (r / (rows - 1)) * p.h;
            for (let c = 0; c < cols; c++) {
              const vx = p.x + (c / (cols - 1)) * p.w;
              const d = Math.hypot(vx - worldX, vy - worldY);
              if (d > radius) continue;

              const falloff = 1 - d / radius;
              const delta = strength * falloff;
              const rec = weights[r * cols + c];
              const cur = rec[boneId] ?? 0;

              if (erase) {
                const next = Math.max(0, cur - delta);
                const removed = cur - next;
                rec[boneId] = next;
                if (fallbackBone && fallbackBone !== boneId) {
                  rec[fallbackBone] = (rec[fallbackBone] ?? 0) + removed;
                }
              } else {
                const next = Math.min(1, cur + delta);
                const remain = 1 - next;
                let otherSum = 0;
                for (const [k, v] of Object.entries(rec)) {
                  if (k !== boneId) otherSum += v;
                }
                if (otherSum > 1e-6) {
                  const scale = remain / otherSum;
                  for (const k of Object.keys(rec)) {
                    if (k !== boneId) rec[k] *= scale;
                  }
                } else if (remain > 0 && fallbackBone && fallbackBone !== boneId) {
                  rec[fallbackBone] = remain;
                }
                rec[boneId] = next;
              }
            }
          }
        }
        if (prev) pushPast(state, prev);
      });
    },

    setShowBones: (showBones) => set({ showBones }),
    setShowParts: (showParts) => set({ showParts }),

    commitSnapshot: (snapshot) => {
      set((state) => {
        pushPast(state, snapshot);
      });
    },

    updateBone: (boneId, patch, recordUndo = true) => {
      const prev = recordUndo ? get().project : null;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch) return;
        const bone = ch.bones.find((b) => b.id === boneId);
        if (!bone) return;
        Object.assign(bone, patch);
        if (prev) pushPast(state, prev);
      });
    },

    addBone: (parentId, opts) => {
      const prev = get().project;
      let createdId: string | null = null;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch) return;
        const id = opts?.id ?? `bone_${Date.now().toString(36)}`;
        createdId = id;
        const defaultX = parentId ? 0 : ch.canvasWidth * 0.5;
        const defaultY = parentId ? -120 : ch.canvasHeight * 0.65;
        const newBone: Bone = {
          id,
          name: opts?.name ?? `Bone_${ch.bones.length + 1}`,
          parentId,
          x: opts?.x ?? defaultX,
          y: opts?.y ?? defaultY,
          rotation: opts?.rotation ?? 0,
          scaleX: opts?.scaleX ?? 1,
          scaleY: opts?.scaleY ?? 1,
          length: opts?.length ?? 180,
          visualAngle: opts?.visualAngle ?? -90,
        };
        ch.bones.push(newBone);
        state.selectedBoneId = id;
        state.selectedPartId = null;
        if (prev) pushPast(state, prev);
      });
      return createdId;
    },

    deleteBone: (boneId) => {
      const prev = get().project;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch) return;
        const target = ch.bones.find((b) => b.id === boneId);
        if (!target) return;
        const fallbackParent = target.parentId ?? null;

        // Reparent child bones
        for (const b of ch.bones) {
          if (b.parentId === boneId) b.parentId = fallbackParent;
        }
        // Unlink parts
        for (const p of ch.parts) {
          if (p.boneId === boneId) p.boneId = fallbackParent ?? '';
        }
        ch.bones = ch.bones.filter((b) => b.id !== boneId);
        if (state.selectedBoneId === boneId) state.selectedBoneId = fallbackParent;
        if (prev) pushPast(state, prev);
      });
    },

    clearBones: () => {
      const prev = get().project;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch) return;
        ch.bones = [];
        for (const p of ch.parts) {
          p.boneId = '';
        }
        state.selectedBoneId = null;
        if (prev) pushPast(state, prev);
      });
    },

    updatePart: (partId, patch, recordUndo = true) => {
      const prev = recordUndo ? get().project : null;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch) return;
        const part = ch.parts.find((p) => p.id === partId);
        if (!part) return;
        Object.assign(part, patch);
        if (prev) pushPast(state, prev);
      });
    },

    createPartGroup: (name, partIds = [], boneId = '') => {
      const prev = get().project;
      let createdId: string | null = null;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch) return;
        if (!ch.partGroups) ch.partGroups = [];
        const id = `grp_${Date.now().toString(36)}`;
        createdId = id;

        const members = ch.parts.filter((p) => partIds.includes(p.id));
        const pivot =
          members.length > 0
            ? {
                x: members.reduce((s, p) => s + p.x + p.w * 0.5, 0) / members.length,
                y: members.reduce((s, p) => s + p.y + p.h * 0.5, 0) / members.length,
              }
            : { x: ch.canvasWidth * 0.5, y: ch.canvasHeight * 0.5 };

        const resolvedBoneId = boneId || state.selectedBoneId || members[0]?.boneId || '';

        ch.partGroups.push({
          id,
          name,
          boneId: resolvedBoneId,
          pivot,
          visible: true,
          skinned: false,
          collapsed: false,
        });

        for (const p of members) {
          p.groupId = id;
          if (resolvedBoneId) p.boneId = resolvedBoneId;
        }

        state.selectedGroupId = id;
        state.selectedBoneId = null;
        state.selectedPartId = null;
        state.selectedPartIds = [];
        if (prev) pushPast(state, prev);
      });
      return createdId;
    },

    updatePartGroup: (groupId, patch, recordUndo = true) => {
      const prev = recordUndo ? get().project : null;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch || !ch.partGroups) return;
        const grp = ch.partGroups.find((g) => g.id === groupId);
        if (!grp) return;
        Object.assign(grp, patch);

        // Keep member parts synced when boneId or skinned changes on the group
        if (patch.boneId !== undefined || patch.skinned !== undefined) {
          for (const p of ch.parts) {
            if (p.groupId === groupId) {
              if (patch.boneId !== undefined) p.boneId = patch.boneId;
              if (patch.skinned !== undefined) p.skinned = patch.skinned;
            }
          }
        }
        if (prev) pushPast(state, prev);
      });
    },

    deletePartGroup: (groupId) => {
      const prev = get().project;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch || !ch.partGroups) return;
        ch.partGroups = ch.partGroups.filter((g) => g.id !== groupId);
        for (const p of ch.parts) {
          if (p.groupId === groupId) {
            p.groupId = null;
            p.boneId = '';
            p.skinned = false;
          }
        }
        if (state.selectedGroupId === groupId) state.selectedGroupId = null;
        if (prev) pushPast(state, prev);
      });
    },

    assignPartsToGroup: (partIds, groupId) => {
      const prev = get().project;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch) return;
        const grp = groupId ? (ch.partGroups ?? []).find((g) => g.id === groupId) : undefined;
        for (const p of ch.parts) {
          if (partIds.includes(p.id)) {
            p.groupId = groupId;
            if (grp) {
              p.boneId = grp.boneId;
              if (grp.skinned !== undefined) p.skinned = grp.skinned;
            } else {
              p.boneId = '';
              p.skinned = false;
            }
          }
        }
        if (prev) pushPast(state, prev);
      });
    },

    setParamValue: (paramId, value) => {
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch) return;
        const param = ch.params.find((p) => p.id === paramId);
        if (!param) return;
        param.value = Math.max(param.min, Math.min(param.max, value));
      });
    },

    resetPose: () => {
      const prev = get().project;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch) return;
        for (const b of ch.bones) {
          b.rotation = 0;
          b.scaleX = 1;
          b.scaleY = 1;
        }
        for (const p of ch.params) {
          p.value = p.defaultValue;
        }
        if (prev) pushPast(state, prev);
      });
    },

    createClip: (name, duration = 2.0, loop = true) => {
      const prev = get().project;
      let createdId: string | null = null;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch) return;
        if (!ch.clips) ch.clips = [];
        const id = `clip_${Date.now().toString(36)}`;
        createdId = id;
        ch.clips.push({
          id,
          name: name ?? `Clip_${ch.clips.length + 1}`,
          duration,
          fps: 30,
          loop,
          tracks: [],
        });
        state.activeClipId = id;
        state.currentTime = 0;
        state.isPlaying = false;
        if (prev) pushPast(state, prev);
      });
      return createdId;
    },

    selectClip: (clipId) => set({ activeClipId: clipId, currentTime: 0, isPlaying: false }),

    deleteClip: (clipId) => {
      const prev = get().project;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch || !ch.clips) return;
        ch.clips = ch.clips.filter((c) => c.id !== clipId);
        if (state.activeClipId === clipId) {
          state.activeClipId = ch.clips[0]?.id ?? null;
          state.currentTime = 0;
          state.isPlaying = false;
        }
        if (prev) pushPast(state, prev);
      });
    },

    updateClip: (clipId, patch) => {
      const prev = get().project;
      set((state) => {
        const ch = getActiveChar(state.project);
        const clip = (ch?.clips ?? []).find((c) => c.id === clipId);
        if (!clip) return;
        Object.assign(clip, patch);
        if (prev) pushPast(state, prev);
      });
    },

    setCurrentTime: (t) => set({ currentTime: Math.max(0, t) }),
    setIsPlaying: (isPlaying) => set({ isPlaying }),
    setAutoKey: (autoKey) => set({ autoKey }),

    setKeyframe: (targetType, targetId, prop, value, time, ease = 'easeInOut') => {
      const prev = get().project;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch) return;
        if (!ch.clips) ch.clips = [];
        let clip = ch.clips.find((c) => c.id === state.activeClipId) ?? ch.clips[0];
        if (!clip) {
          const id = `clip_${Date.now().toString(36)}`;
          clip = { id, name: 'Anim_1', duration: 2.0, fps: 30, loop: true, tracks: [] };
          ch.clips.push(clip);
          state.activeClipId = id;
        }
        const t = Math.round((time ?? state.currentTime) * 100) / 100;
        let track = clip.tracks.find(
          (tr) => tr.targetType === targetType && tr.targetId === targetId && tr.prop === prop
        );
        if (!track) {
          track = {
            id: `trk_${targetId}_${prop}_${Date.now().toString(36)}`,
            targetType,
            targetId,
            prop,
            keys: [],
          };
          clip.tracks.push(track);
        }
        const existing = track.keys.find((k) => Math.abs(k.t - t) < 0.015);
        if (existing) {
          existing.v = value;
          existing.ease = ease;
        } else {
          track.keys.push({ t, v: value, ease });
          track.keys.sort((a, b) => a.t - b.t);
        }
        if (t > clip.duration) clip.duration = t;
        if (prev) pushPast(state, prev);
      });
    },

    deleteKeyframe: (trackId, time) => {
      const prev = get().project;
      set((state) => {
        const ch = getActiveChar(state.project);
        const clip = (ch?.clips ?? []).find((c) => c.id === state.activeClipId);
        if (!clip) return;
        const track = clip.tracks.find((tr) => tr.id === trackId);
        if (!track) return;
        track.keys = track.keys.filter((k) => Math.abs(k.t - time) >= 0.015);
        if (track.keys.length === 0) {
          clip.tracks = clip.tracks.filter((tr) => tr.id !== trackId);
        }
        if (prev) pushPast(state, prev);
      });
    },

    keyCurrentPose: () => {
      const state = get();
      const ch = getActiveChar(state.project);
      if (!ch) return;
      for (const b of ch.bones) {
        if (Math.abs(b.rotation) > 0.01) {
          state.setKeyframe('bone', b.id, 'rotation', b.rotation);
        }
        if (Math.abs(b.scaleX - 1) > 0.001) {
          state.setKeyframe('bone', b.id, 'scaleX', b.scaleX);
        }
        if (Math.abs(b.scaleY - 1) > 0.001) {
          state.setKeyframe('bone', b.id, 'scaleY', b.scaleY);
        }
      }
      for (const p of ch.params) {
        if (Math.abs(p.value - p.defaultValue) > 0.001) {
          state.setKeyframe('param', p.id, 'value', p.value);
        }
      }
    },

    applyAnimPreset: (preset) => {
      const prev = get().project;
      let createdId: string | null = null;
      set((state) => {
        const ch = getActiveChar(state.project);
        if (!ch) return;
        if (!ch.clips) ch.clips = [];
        const clip = createPresetClip(preset, ch);
        createdId = clip.id;
        ch.clips.push(clip);
        state.activeClipId = clip.id;
        state.currentTime = 0;
        state.isPlaying = true;
        state.mode = 'animate';
        if (prev) pushPast(state, prev);
      });
      return createdId;
    },

    undo: () => {
      set((state) => {
        const prev = state.past.pop();
        if (!prev || !state.project) return;
        state.future.push(state.project);
        state.project = prev;
      });
    },

    redo: () => {
      set((state) => {
        const next = state.future.pop();
        if (!next || !state.project) return;
        state.past.push(state.project);
        state.project = next;
      });
    },
  }))
);

export function selectActiveCharacter(state: MurigState): Character | undefined {
  return getActiveChar(state.project);
}
