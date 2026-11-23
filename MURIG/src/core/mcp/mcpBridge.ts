import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { importPsdBuffer } from '../import/psdImporter';
import { selectActiveCharacter, useMurigStore } from '../commands/store';

let capturePreviewFn: (() => Promise<string | null>) | null = null;

export function registerPreviewCapture(fn: (() => Promise<string | null>) | null) {
  capturePreviewFn = fn;
}

interface McpCallEvent {
  reqId: string;
  tool: string;
  args: Record<string, unknown>;
}

async function executeMcpTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const state = useMurigStore.getState();

  if (tool === 'open_psd') {
    const path = String(args.path ?? '');
    const bytes = await invoke<number[]>('read_file_bytes', { path });
    const res = importPsdBuffer(new Uint8Array(bytes));
    const fileName = path.split('/').pop() ?? 'character.psd';
    state.loadFromPsdEntries(fileName, res.characters, path);
    if (typeof args.character === 'string') {
      const target = res.characters.find(
        (c) => c.name.toLowerCase() === String(args.character).toLowerCase()
      );
      if (target) useMurigStore.getState().selectCharacter(target.character.id);
    }
    return {
      ok: true,
      characters: res.characters.map((c) => c.name),
    };
  }

  if (tool === 'update_psd') {
    const path = String(args.path ?? state.project?.sourcePsdPath ?? '');
    if (!path) return { error: 'No PSD path provided and project.sourcePsdPath is not set' };
    const bytes = await invoke<number[]>('read_file_bytes', { path });
    const res = importPsdBuffer(new Uint8Array(bytes));
    const summary = state.updateFromPsdEntries(res.characters, path);
    return {
      ok: true,
      path,
      summary,
    };
  }

  if (tool === 'open_project') {
    const path = String(args.path ?? '');
    const text = await invoke<string>('read_text_file', { path });
    const parsed = JSON.parse(text);
    state.loadProject(parsed, path);
    return {
      ok: true,
      name: parsed.name,
      characters: (parsed.characters ?? []).map((c: { name: string }) => c.name),
    };
  }

  const ch = selectActiveCharacter(state);

  if (!ch && tool !== 'render_preview') {
    return { error: 'No active character loaded in MURIG' };
  }

  switch (tool) {
    case 'get_character': {
      return {
        name: ch!.name,
        canvasWidth: ch!.canvasWidth,
        canvasHeight: ch!.canvasHeight,
        bones: ch!.bones,
        partGroups: ch!.partGroups ?? [],
        parts: ch!.parts.map(({ imageDataUrl: _img, variants: _v, ...rest }) => rest),
        params: ch!.params.map((p) => ({
          id: p.id,
          name: p.name,
          min: p.min,
          max: p.max,
          defaultValue: p.defaultValue,
          value: p.value,
        })),
        warnings: ch!.warnings,
      };
    }

    case 'add_bone': {
      const parentId = args.parentId === undefined ? null : (args.parentId as string | null);
      const id = state.addBone(parentId, {
        id: args.id as string | undefined,
        name: args.name as string | undefined,
        x: typeof args.x === 'number' ? args.x : 0,
        y: typeof args.y === 'number' ? args.y : 0,
        length: typeof args.length === 'number' ? args.length : 120,
        visualAngle: typeof args.visualAngle === 'number' ? args.visualAngle : -90,
      });
      return { ok: true, id };
    }

    case 'set_bone': {
      const id = String(args.id ?? '');
      const patch: Record<string, unknown> = {};
      for (const k of ['name', 'parentId', 'x', 'y', 'rotation', 'scaleX', 'scaleY', 'length', 'visualAngle']) {
        if (args[k] !== undefined) patch[k] = args[k];
      }
      state.updateBone(id, patch);
      return { ok: true, id };
    }

    case 'delete_bone': {
      const id = String(args.id ?? '');
      state.deleteBone(id);
      return { ok: true, id };
    }

    case 'bind_part': {
      const partId = String(args.partId ?? '');
      const part = ch!.parts.find((p) => p.id === partId || p.name === partId);
      if (!part) return { error: `Part not found: ${partId}` };
      const patch: Record<string, unknown> = { boneId: String(args.boneId ?? '') };
      if (typeof args.pivotX === 'number' || typeof args.pivotY === 'number') {
        patch.pivot = {
          x: typeof args.pivotX === 'number' ? args.pivotX : part.pivot.x,
          y: typeof args.pivotY === 'number' ? args.pivotY : part.pivot.y,
        };
      }
      if (typeof args.parallax === 'number') patch.parallax = args.parallax;
      state.updatePart(part.id, patch);
      return { ok: true, partId: part.id, boneId: patch.boneId };
    }

    case 'create_part_group': {
      const name = String(args.name ?? 'Group');
      const rawIds = Array.isArray(args.partIds) ? args.partIds.map(String) : [];
      const resolvedIds = rawIds
        .map((q) => ch!.parts.find((p) => p.id === q || p.name === q)?.id)
        .filter((id): id is string => Boolean(id));
      const boneId = typeof args.boneId === 'string' ? args.boneId : '';
      const id = state.createPartGroup(name, resolvedIds, boneId);
      return { ok: true, id, memberCount: resolvedIds.length };
    }

    case 'bind_group': {
      const groupId = String(args.groupId ?? '');
      const grp = (ch!.partGroups ?? []).find((g) => g.id === groupId || g.name === groupId);
      if (!grp) return { error: `Group not found: ${groupId}` };
      const patch: Record<string, unknown> = { boneId: String(args.boneId ?? grp.boneId) };
      if (typeof args.skinned === 'boolean') patch.skinned = args.skinned;
      state.updatePartGroup(grp.id, patch);
      return { ok: true, groupId: grp.id, ...patch };
    }

    case 'delete_group': {
      const groupId = String(args.groupId ?? '');
      const grp = (ch!.partGroups ?? []).find((g) => g.id === groupId || g.name === groupId);
      if (!grp) return { error: `Group not found: ${groupId}` };
      state.deletePartGroup(grp.id);
      return { ok: true, deletedGroupId: grp.id };
    }

    case 'set_skinning': {
      const targetType = String(args.targetType ?? 'part');
      const id = String(args.id ?? '');
      const skinned = Boolean(args.skinned);
      if (targetType === 'group') {
        const grp = (ch!.partGroups ?? []).find((g) => g.id === id || g.name === id);
        if (!grp) return { error: `Group not found: ${id}` };
        state.updatePartGroup(grp.id, { skinned });
        return { ok: true, groupId: grp.id, skinned };
      } else {
        const part = ch!.parts.find((p) => p.id === id || p.name === id);
        if (!part) return { error: `Part not found: ${id}` };
        state.updatePart(part.id, { skinned });
        return { ok: true, partId: part.id, skinned };
      }
    }

    case 'set_param': {
      const id = String(args.id ?? '');
      const val = Number(args.value ?? 0);
      state.setParamValue(id, val);
      return { ok: true, id, value: val };
    }

    case 'reset_pose': {
      state.resetPose();
      return { ok: true };
    }

    case 'paint_weights': {
      const boneId = String(args.boneId ?? '');
      const x = Number(args.x ?? 0);
      const y = Number(args.y ?? 0);
      const radius = Number(args.radius ?? 150);
      const strength = Number(args.strength ?? 1.0);
      const erase = Boolean(args.erase);
      state.paintWeightsAt(x, y, boneId, radius, strength, erase, true);
      return { ok: true, boneId, x, y, radius };
    }

    case 'create_clip': {
      const name = String(args.name ?? 'Anim_1');
      const duration = typeof args.duration === 'number' ? args.duration : 3.2;
      const loop = typeof args.loop === 'boolean' ? args.loop : true;
      const id = state.createClip(name, duration, loop);
      state.setMode('animate');
      return { ok: true, id, name };
    }

    case 'delete_clip': {
      const q = String(args.id ?? '');
      const clip = (ch!.clips ?? []).find((c) => c.id === q || c.name === q);
      if (!clip) return { error: `Clip not found: ${q}` };
      state.deleteClip(clip.id);
      return { ok: true, deletedId: clip.id };
    }

    case 'apply_preset': {
      const preset = (args.preset as 'idle' | 'wave' | 'nod') ?? 'idle';
      const id = state.applyAnimPreset(preset);
      return { ok: true, clipId: id, preset };
    }

    case 'set_keyframe': {
      const targetType = (args.targetType as 'bone' | 'param') ?? 'bone';
      const targetId = String(args.targetId ?? '');
      const prop = (args.prop as 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'value') ?? 'rotation';
      const time = Number(args.time ?? 0);
      const value = Number(args.value ?? 0);
      if (targetType === 'param' && targetId === 'MouthOpen') {
        useMurigStore.setState((s) => {
          const c = s.project?.characters.find((x) => x.id === s.project?.activeCharacterId);
          const mp = c?.params.find((p) => p.id === 'MouthOpen');
          if (mp && mp.min > -1) {
            mp.min = -1;
            for (const b of mp.bindings) {
              if (b.prop === 'scaleY' && !b.keys.some((k) => k.param < 0)) {
                b.keys.unshift({ param: -1, value: 0.45 });
              }
            }
          }
        });
      }
      if (targetType === 'param' && targetId === 'BrowY' && !ch!.params.some((p) => p.id === 'BrowY')) {
        const brows = ch!.parts.filter((p) => /eyebrow|brow/i.test(p.name));
        if (brows.length > 0) {
          useMurigStore.setState((s) => {
            const c = s.project?.characters.find((x) => x.id === s.project?.activeCharacterId);
            if (c && !c.params.some((p) => p.id === 'BrowY')) {
              c.params.push({
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
          });
        }
      }
      const ease = (args.ease as 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'step') ?? 'easeInOut';
      state.setKeyframe(targetType, targetId, prop as 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'value', value, time, ease);
      return { ok: true, targetType, targetId, prop, time, value, ease };
    }

    case 'render_preview': {
      if (!capturePreviewFn) return { error: 'Viewport not ready' };
      const b64 = await capturePreviewFn();
      if (!b64) return { error: 'Failed to capture preview' };
      return { imageBase64: b64 };
    }

    default:
      return { error: `Unknown tool: ${tool}` };
  }
}

export function initMcpBridge(onActivity?: (msg: string) => void): () => void {
  let unlisten: (() => void) | undefined;

  void listen<McpCallEvent>('murig://mcp-call', async (event) => {
    const { reqId, tool, args } = event.payload;
    onActivity?.(`MCP: ${tool}`);
    let result: unknown;
    try {
      result = await executeMcpTool(tool, args ?? {});
    } catch (e) {
      result = { error: e instanceof Error ? e.message : String(e) };
    }
    try {
      await invoke('mcp_reply', { reqId, result });
    } catch {
      // ignore if not in Tauri
    }
  })
    .then((fn) => {
      unlisten = fn;
    })
    .catch(() => {});

  return () => {
    unlisten?.();
  };
}
