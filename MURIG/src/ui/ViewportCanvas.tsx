import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Application, Assets, Container, Graphics, Matrix, MeshPlane, Sprite, Texture } from 'pixi.js';
import { Upload } from 'lucide-react';
import { importPsdBuffer } from '../core/import/psdImporter';
import { evaluateCharacterAtTime } from '../core/anim/animEvaluator';
import { registerPreviewCapture } from '../core/mcp/mcpBridge';
import { selectActiveCharacter, useMurigStore } from '../core/commands/store';
import {
  generateAutoWeights,
  invertMat,
  makeTRS,
  mulMat,
  solveRig,
  solveSkinnedMeshVertices,
  transformPoint,
} from '../core/rig/rigSolver';

const MESH_COLS = 32;
const MESH_ROWS = 32;

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const ViewportCanvas: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const partsLayerRef = useRef<Container | null>(null);
  const frameGfxRef = useRef<Graphics | null>(null);
  const textureCacheRef = useRef<Map<string, Texture>>(new Map());
  const spritesRef = useRef<Map<string, Sprite | MeshPlane>>(new Map());

  const activeChar = useMurigStore(selectActiveCharacter);
  const mode = useMurigStore((s) => s.mode);
  const rigTool = useMurigStore((s) => s.rigTool);
  const brushSize = useMurigStore((s) => s.brushSize);
  const brushStrength = useMurigStore((s) => s.brushStrength);
  const brushMode = useMurigStore((s) => s.brushMode);
  const showBones = useMurigStore((s) => s.showBones);
  const showParts = useMurigStore((s) => s.showParts);
  const selectedBoneId = useMurigStore((s) => s.selectedBoneId);
  const selectedPartId = useMurigStore((s) => s.selectedPartId);
  const activeClipId = useMurigStore((s) => s.activeClipId);
  const currentTime = useMurigStore((s) => s.currentTime);
  const isPlaying = useMurigStore((s) => s.isPlaying);
  const autoKey = useMurigStore((s) => s.autoKey);

  const selectBone = useMurigStore((s) => s.selectBone);
  const updateBone = useMurigStore((s) => s.updateBone);
  const updatePart = useMurigStore((s) => s.updatePart);
  const paintWeightsAt = useMurigStore((s) => s.paintWeightsAt);
  const setCurrentTime = useMurigStore((s) => s.setCurrentTime);
  const setIsPlaying = useMurigStore((s) => s.setIsPlaying);
  const setKeyframe = useMurigStore((s) => s.setKeyframe);
  const commitSnapshot = useMurigStore((s) => s.commitSnapshot);
  const loadFromPsdEntries = useMurigStore((s) => s.loadFromPsdEntries);

  const [camera, setCamera] = useState<Camera>({ x: 100, y: 40, zoom: 0.25 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [brushCursor, setBrushCursor] = useState<{ sx: number; sy: number } | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isLoadingPsd, setIsLoadingPsd] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pixiReady, setPixiReady] = useState(false);

  // Fit character in viewport when character changes
  useEffect(() => {
    if (!activeChar || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const zoom = Math.min(
      (rect.width * 0.8) / activeChar.canvasWidth,
      (rect.height * 0.85) / activeChar.canvasHeight
    );
    const x = (rect.width - activeChar.canvasWidth * zoom) / 2;
    const y = (rect.height - activeChar.canvasHeight * zoom) / 2;
    setCamera({ x, y, zoom });
  }, [activeChar?.id]);

  // Spacebar panning shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT') {
        setSpaceHeld(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Initialize PixiJS v8
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let destroyed = false;

    const app = new Application();
    void app
      .init({
        resizeTo: el,
        backgroundAlpha: 0,
        antialias: true,
        resolution: window.devicePixelRatio || 1,
        autoDensity: true,
      })
      .then(() => {
        if (destroyed) {
          app.destroy(true);
          return;
        }
        el.appendChild(app.canvas);
        app.canvas.style.position = 'absolute';
        app.canvas.style.inset = '0';
        app.canvas.style.width = '100%';
        app.canvas.style.height = '100%';

        const world = new Container();
        const frameGfx = new Graphics();
        const partsLayer = new Container();
        partsLayer.sortableChildren = true;

        world.addChild(frameGfx);
        world.addChild(partsLayer);
        app.stage.addChild(world);

        appRef.current = app;
        worldRef.current = world;
        frameGfxRef.current = frameGfx;
        partsLayerRef.current = partsLayer;
        setPixiReady(true);

        registerPreviewCapture(async () => {
          if (!appRef.current || !partsLayerRef.current) return null;
          const dataUrl = await appRef.current.renderer.extract.base64(partsLayerRef.current);
          return dataUrl.replace(/^data:image\/\w+;base64,/, '');
        });
      });

    return () => {
      destroyed = true;
      registerPreviewCapture(null);
      setPixiReady(false);
      appRef.current?.destroy(true);
      appRef.current = null;
      spritesRef.current.clear();
      textureCacheRef.current.clear();
    };
  }, []);

  // Sync camera transform
  useEffect(() => {
    if (!worldRef.current) return;
    worldRef.current.position.set(camera.x, camera.y);
    worldRef.current.scale.set(camera.zoom);
  }, [camera, pixiReady]);

  // 60fps animation playback loop
  const activeClip = useMemo(() => {
    if (!activeChar) return undefined;
    const clips = activeChar.clips ?? [];
    return clips.find((c) => c.id === activeClipId) ?? clips[0];
  }, [activeChar, activeClipId]);

  useEffect(() => {
    if (!isPlaying || !activeClip) return;
    let rafId = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const st = useMurigStore.getState();
      if (!st.isPlaying) return;
      let nextT = st.currentTime + dt;
      if (activeClip.duration > 0) {
        if (nextT >= activeClip.duration) {
          if (activeClip.loop) {
            nextT = nextT % activeClip.duration;
          } else {
            nextT = activeClip.duration;
            setCurrentTime(nextT);
            setIsPlaying(false);
            return;
          }
        }
      }
      setCurrentTime(nextT);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, activeClip, setCurrentTime, setIsPlaying]);

  // Evaluate character at currentTime when in animate mode
  const displayChar = useMemo(() => {
    if (!activeChar) return undefined;
    if (mode === 'animate' && activeClip) {
      return evaluateCharacterAtTime(activeChar, activeClip, currentTime);
    }
    return activeChar;
  }, [activeChar, mode, activeClip, currentTime]);

  // Solve rig for current state
  const solvedRig = useMemo(() => {
    if (!displayChar) return null;
    return solveRig(displayChar);
  }, [displayChar]);

  // Draw canvas boundary (lightweight, runs on zoom/canvas size change without re-solving meshes)
  useEffect(() => {
    if (!pixiReady || !frameGfxRef.current) return;
    const frameGfx = frameGfxRef.current;
    frameGfx.clear();
    if (!activeChar) return;
    frameGfx
      .rect(0, 0, activeChar.canvasWidth, activeChar.canvasHeight)
      .stroke({ width: 2 / Math.max(0.05, camera.zoom), color: 0x3b4252, alpha: 0.7 });
  }, [activeChar?.canvasWidth, activeChar?.canvasHeight, camera.zoom, pixiReady]);

  // Sync PixiJS sprites with active character & solved rig
  useEffect(() => {
    if (!pixiReady || !partsLayerRef.current) return;
    const partsLayer = partsLayerRef.current;

    if (!activeChar || !solvedRig) {
      partsLayer.removeChildren();
      spritesRef.current.clear();
      return;
    }

    partsLayer.visible = showParts;

    // Remove stale sprites
    const activeIds = new Set(activeChar.parts.map((p) => p.id));
    for (const [id, spr] of spritesRef.current.entries()) {
      if (!activeIds.has(id)) {
        partsLayer.removeChild(spr);
        spr.destroy();
        spritesRef.current.delete(id);
      }
    }

    // Create/update sprites / skinned meshes
    const groupMap = new Map((activeChar.partGroups ?? []).map((g) => [g.id, g]));
    for (const part of activeChar.parts) {
      const solved = solvedRig.parts.get(part.id);
      if (!solved) continue;

      const group = part.groupId ? groupMap.get(part.groupId) : undefined;
      const effectiveVisible = part.visible && (group ? group.visible : true);
      const wantMesh = Boolean(group?.skinned !== undefined ? group.skinned : part.skinned);
      let displayObj = spritesRef.current.get(part.id);
      const isMesh = displayObj instanceof MeshPlane;

      if (!displayObj || isMesh !== wantMesh) {
        if (displayObj) {
          partsLayer.removeChild(displayObj);
          displayObj.destroy();
        }
        displayObj = wantMesh
          ? new MeshPlane({ texture: Texture.EMPTY, verticesX: MESH_COLS, verticesY: MESH_ROWS })
          : new Sprite();
        spritesRef.current.set(part.id, displayObj);
        partsLayer.addChild(displayObj);
      }

      const applyTransform = (obj: Sprite | MeshPlane) => {
        obj.visible = effectiveVisible;
        if (!effectiveVisible) return;
        obj.alpha = solved.alpha;
        obj.zIndex = part.z;

        if (obj instanceof MeshPlane) {
          obj.setFromMatrix(Matrix.IDENTITY);
          const verts = solveSkinnedMeshVertices(displayChar!, part, solvedRig, MESH_COLS, MESH_ROWS);
          const posBuf = obj.geometry.getBuffer('aPosition');
          if (posBuf && posBuf.data.length === verts.length) {
            posBuf.data.set(verts);
            posBuf.update();
          }
        } else {
          const mat = mulMat(solved.worldMatrix, makeTRS(part.x, part.y, 0, 1, 1));
          obj.setFromMatrix(new Matrix(mat.a, mat.b, mat.c, mat.d, mat.tx, mat.ty));
        }
      };

      if (part.imageDataUrl) {
        const cached = textureCacheRef.current.get(part.imageDataUrl);
        if (cached) {
          if (displayObj.texture !== cached) displayObj.texture = cached;
          applyTransform(displayObj);
        } else {
          void Assets.load<Texture>(part.imageDataUrl).then((tex) => {
            textureCacheRef.current.set(part.imageDataUrl, tex);
            if (displayObj && !displayObj.destroyed) {
              displayObj.texture = tex;
              applyTransform(displayObj);
            }
          });
        }
      } else {
        applyTransform(displayObj);
      }
    }
  }, [activeChar, solvedRig, showParts, pixiReady]);

  // Camera zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    setCamera((prev) => {
      const nextZoom = Math.min(4, Math.max(0.05, prev.zoom * factor));
      const wx = (mx - prev.x) / prev.zoom;
      const wy = (my - prev.y) / prev.zoom;
      return {
        zoom: nextZoom,
        x: mx - wx * nextZoom,
        y: my - wy * nextZoom,
      };
    });
  };

  // Panning or Weight Brush painting
  const handleViewportPointerDown = (e: React.PointerEvent) => {
    // Weight Brush left-click
    if (
      mode === 'rig' &&
      rigTool === 'weight' &&
      e.button === 0 &&
      !spaceHeld &&
      selectedBoneId
    ) {
      const snapshot = useMurigStore.getState().project;
      const paintAt = (clientX: number, clientY: number, altKey: boolean) => {
        const w = screenToWorld(clientX, clientY);
        paintWeightsAt(
          w.x,
          w.y,
          selectedBoneId,
          brushSize,
          brushStrength * 0.45,
          brushMode === 'erase' || altKey,
          false
        );
      };
      paintAt(e.clientX, e.clientY, e.altKey);
      const onMove = (ev: PointerEvent) => paintAt(ev.clientX, ev.clientY, ev.altKey);
      const onUp = () => {
        if (snapshot) commitSnapshot(snapshot);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }

    if (e.button === 1 || e.button === 2 || spaceHeld || e.target === e.currentTarget) {
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = camera.x;
      const origY = camera.y;
      const onMove = (ev: PointerEvent) => {
        setCamera((c) => ({
          ...c,
          x: origX + (ev.clientX - startX),
          y: origY + (ev.clientY - startY),
        }));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }
  };

  const screenToWorld = (clientX: number, clientY: number) => {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - camera.x) / camera.zoom,
      y: (clientY - rect.top - camera.y) / camera.zoom,
    };
  };

  // Dragging bone joint (Rig Mode)
  const startDragJoint = (boneId: string, e: React.PointerEvent) => {
    e.stopPropagation();
    selectBone(boneId);
    if (mode !== 'rig' || !activeChar || !solvedRig) return;

    const bone = activeChar.bones.find((b) => b.id === boneId);
    if (!bone) return;
    const snapshot = useMurigStore.getState().project;
    const parentSolved = bone.parentId ? solvedRig.bones.get(bone.parentId) : undefined;
    const invParent = parentSolved ? invertMat(parentSolved.world) : null;

    const startW = screenToWorld(e.clientX, e.clientY);
    const startLocal = invParent ? transformPoint(invParent, startW.x, startW.y) : startW;
    const origX = bone.x;
    const origY = bone.y;

    const onMove = (ev: PointerEvent) => {
      const curW = screenToWorld(ev.clientX, ev.clientY);
      const curLocal = invParent ? transformPoint(invParent, curW.x, curW.y) : curW;
      updateBone(
        boneId,
        {
          x: origX + (curLocal.x - startLocal.x),
          y: origY + (curLocal.y - startLocal.y),
        },
        false
      );
    };
    const onUp = () => {
      if (snapshot) commitSnapshot(snapshot);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Dragging bone tip (Rig Mode: length/angle, Pose Mode: rotation)
  const startDragTip = (boneId: string, e: React.PointerEvent) => {
    e.stopPropagation();
    selectBone(boneId);
    if (!activeChar || !solvedRig) return;
    const bone = activeChar.bones.find((b) => b.id === boneId);
    const solved = solvedRig.bones.get(boneId);
    if (!bone || !solved) return;

    const snapshot = useMurigStore.getState().project;
    const origin = solved.worldPos;
    const startW = screenToWorld(e.clientX, e.clientY);
    const startAngle = (Math.atan2(startW.y - origin.y, startW.x - origin.x) * 180) / Math.PI;
    const origRot = bone.rotation;
    let latestRot = origRot;

    const onMove = (ev: PointerEvent) => {
      const curW = screenToWorld(ev.clientX, ev.clientY);
      const dx = curW.x - origin.x;
      const dy = curW.y - origin.y;
      const curAngle = (Math.atan2(dy, dx) * 180) / Math.PI;

      if (mode === 'pose' || mode === 'animate') {
        let delta = curAngle - startAngle;
        while (delta > 180) delta -= 360;
        while (delta < -180) delta += 360;
        latestRot = origRot + delta;
        if (mode === 'animate' && autoKey) {
          setKeyframe('bone', boneId, 'rotation', latestRot);
        } else {
          updateBone(boneId, { rotation: latestRot }, false);
        }
      } else {
        const len = Math.max(25, Math.hypot(dx, dy));
        updateBone(boneId, { length: len, visualAngle: curAngle - bone.rotation }, false);
      }
    };
    const onUp = () => {
      if (snapshot && !(mode === 'animate' && autoKey)) commitSnapshot(snapshot);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Dragging part pivot (Rig Mode)
  const startDragPivot = (partId: string, e: React.PointerEvent) => {
    e.stopPropagation();
    if (mode !== 'rig' || !activeChar) return;
    const part = activeChar.parts.find((p) => p.id === partId);
    if (!part) return;
    const snapshot = useMurigStore.getState().project;
    const startW = screenToWorld(e.clientX, e.clientY);
    const origPivot = { ...part.pivot };

    const onMove = (ev: PointerEvent) => {
      const curW = screenToWorld(ev.clientX, ev.clientY);
      updatePart(
        partId,
        {
          pivot: {
            x: origPivot.x + (curW.x - startW.x),
            y: origPivot.y + (curW.y - startW.y),
          },
        },
        false
      );
    };
    const onUp = () => {
      if (snapshot) commitSnapshot(snapshot);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!/\.psd$/i.test(file.name)) {
      setLoadError(`Unsupported file "${file.name}". Please drop a .psd file.`);
      return;
    }
    try {
      setLoadError(null);
      setIsLoadingPsd(true);
      await new Promise((r) => setTimeout(r, 30));
      const buf = await file.arrayBuffer();
      const res = importPsdBuffer(buf);
      loadFromPsdEntries(file.name, res.characters);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingPsd(false);
    }
  };

  const selectedPart = activeChar?.parts.find((p) => p.id === selectedPartId);

  return (
    <main
      ref={containerRef}
      className="viewport-container"
      onWheel={handleWheel}
      onPointerDown={handleViewportPointerDown}
      onPointerMove={(e) => {
        if (mode === 'rig' && rigTool === 'weight' && containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          setBrushCursor({ sx: e.clientX - rect.left, sy: e.clientY - rect.top });
        } else if (brushCursor) {
          setBrushCursor(null);
        }
      }}
      onPointerLeave={() => setBrushCursor(null)}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={() => setIsDraggingFile(false)}
      onDrop={handleDrop}
      style={{ cursor: spaceHeld ? 'grab' : mode === 'rig' && rigTool === 'weight' ? 'crosshair' : 'default' }}
    >
      <div className="viewport-checker" />

      {!activeChar && (
        <div className="empty-state">
          <div className="drop-card" style={{ borderColor: isDraggingFile ? 'var(--accent)' : undefined }}>
            <Upload size={32} style={{ color: 'var(--accent)' }} />
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {isLoadingPsd ? 'Importing PSD...' : 'Drop a .PSD character file here'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {isLoadingPsd
                ? 'Extracting layers and building auto-rig'
                : <>or click <b>Import PSD</b> in the toolbar (e.g. va_char.psd)</>}
            </div>
            {loadError && (
              <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>{loadError}</div>
            )}
          </div>
        </div>
      )}

      {activeChar && activeChar.warnings.length > 0 && (
        <div className="warning-pill">
          {activeChar.warnings.map((w, i) => (
            <div key={i}>⚠ {w.message}</div>
          ))}
        </div>
      )}

      {/* Crisp SVG Bone & Pivot Gizmo Overlay */}
      {activeChar && solvedRig && (
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 4,
          }}
        >
          {/* Unity-style Weight Heat-Map Overlay when Weight Brush is active */}
          {mode === 'rig' && rigTool === 'weight' && selectedBoneId && (() => {
            const groupMap = new Map((activeChar.partGroups ?? []).map((g) => [g.id, g]));
            const targetParts = activeChar.parts.filter((p) => {
              const grp = p.groupId ? groupMap.get(p.groupId) : undefined;
              return p.visible && Boolean(grp?.skinned !== undefined ? grp.skinned : p.skinned);
            });
            return targetParts.map((p) => {
              const wm =
                p.meshWeights && p.meshWeights.cols === MESH_COLS && p.meshWeights.rows === MESH_ROWS
                  ? p.meshWeights
                  : generateAutoWeights(activeChar, p, solvedRig, MESH_COLS, MESH_ROWS);
              const dots: React.ReactNode[] = [];
              // Sample every 2nd vertex (16x16 = 256 dots) for crisp 60fps SVG overlay
              for (let r = 0; r < wm.rows; r += 2) {
                const vy = p.y + (r / (wm.rows - 1)) * p.h;
                for (let c = 0; c < wm.cols; c += 2) {
                  const vx = p.x + (c / (wm.cols - 1)) * p.w;
                  const w = wm.weights[r * wm.cols + c]?.[selectedBoneId] ?? 0;
                  if (w < 0.03) continue;
                  const sx = vx * camera.zoom + camera.x;
                  const sy = vy * camera.zoom + camera.y;
                  const hue = Math.round((1 - Math.min(1, w)) * 210); // 210 blue -> 0 red
                  dots.push(
                    <circle
                      key={`${p.id}_${r}_${c}`}
                      cx={sx}
                      cy={sy}
                      r={2.8 + w * 2.5}
                      fill={`hsla(${hue}, 95%, 55%, ${0.35 + w * 0.6})`}
                    />
                  );
                }
              }
              return <g key={`wm_${p.id}`}>{dots}</g>;
            });
          })()}

          {mode === 'rig' && rigTool === 'weight' && brushCursor && (
            <circle
              cx={brushCursor.sx}
              cy={brushCursor.sy}
              r={brushSize * camera.zoom}
              fill="none"
              stroke={brushMode === 'erase' ? '#ef4444' : '#facc15'}
              strokeWidth={1.5}
              strokeDasharray="4 3"
            />
          )}

          {showBones &&
            activeChar.bones.map((bone) => {
              const sb = solvedRig.bones.get(bone.id);
              if (!sb) return null;
              const parentSb = bone.parentId ? solvedRig.bones.get(bone.parentId) : null;
              const sx = sb.worldPos.x * camera.zoom + camera.x;
              const sy = sb.worldPos.y * camera.zoom + camera.y;
              const tx = sb.tipPos.x * camera.zoom + camera.x;
              const ty = sb.tipPos.y * camera.zoom + camera.y;
              const isSelected = selectedBoneId === bone.id;
              const color = isSelected ? '#facc15' : '#38bdf8';

              // Bone diamond/wedge points
              const dx = tx - sx;
              const dy = ty - sy;
              const len = Math.max(1, Math.hypot(dx, dy));
              const nx = (-dy / len) * 6;
              const ny = (dx / len) * 6;
              const mx = sx + dx * 0.2;
              const my = sy + dy * 0.2;

              return (
                <g key={bone.id}>
                  {parentSb && (
                    <line
                      x1={parentSb.worldPos.x * camera.zoom + camera.x}
                      y1={parentSb.worldPos.y * camera.zoom + camera.y}
                      x2={sx}
                      y2={sy}
                      stroke="rgba(148, 163, 184, 0.45)"
                      strokeWidth={1.2}
                      strokeDasharray="4 3"
                    />
                  )}
                  <polygon
                    points={`${sx},${sy} ${mx + nx},${my + ny} ${tx},${ty} ${mx - nx},${my - ny}`}
                    fill={color}
                    fillOpacity={isSelected ? 0.35 : 0.18}
                    stroke={color}
                    strokeWidth={isSelected ? 2 : 1.3}
                    style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                    onPointerDown={(e) => startDragJoint(bone.id, e)}
                  />
                  {/* Joint Circle */}
                  <circle
                    cx={sx}
                    cy={sy}
                    r={isSelected ? 6 : 4.5}
                    fill="#121418"
                    stroke={color}
                    strokeWidth={2}
                    style={{
                      pointerEvents: 'auto',
                      cursor: mode === 'rig' ? 'move' : 'pointer',
                    }}
                    onPointerDown={(e) => startDragJoint(bone.id, e)}
                  />
                  {/* Tip Handle (Rotate in Pose mode, Adjust in Rig mode) */}
                  <circle
                    cx={tx}
                    cy={ty}
                    r={isSelected ? 5 : 3.5}
                    fill={color}
                    style={{
                      pointerEvents: 'auto',
                      cursor: mode === 'pose' || mode === 'animate' ? 'grab' : 'crosshair',
                    }}
                    onPointerDown={(e) => startDragTip(bone.id, e)}
                  />
                  {isSelected && (
                    <text
                      x={sx + 10}
                      y={sy - 8}
                      fill="#facc15"
                      fontSize={11}
                      fontWeight={600}
                    >
                      {bone.name}
                    </text>
                  )}
                </g>
              );
            })}

          {/* Selected Part Pivot Crosshair */}
          {selectedPart && (
            <g
              style={{
                pointerEvents: 'auto',
                cursor: mode === 'rig' ? 'move' : 'default',
              }}
              onPointerDown={(e) => startDragPivot(selectedPart.id, e)}
            >
              {(() => {
                const px = selectedPart.pivot.x * camera.zoom + camera.x;
                const py = selectedPart.pivot.y * camera.zoom + camera.y;
                return (
                  <>
                    <circle cx={px} cy={py} r={8} fill="rgba(244, 63, 94, 0.2)" stroke="#f43f5e" strokeWidth={1.5} />
                    <line x1={px - 12} y1={py} x2={px + 12} y2={py} stroke="#f43f5e" strokeWidth={1.5} />
                    <line x1={px} y1={py - 12} x2={px} y2={py + 12} stroke="#f43f5e" strokeWidth={1.5} />
                  </>
                );
              })()}
            </g>
          )}
        </svg>
      )}
    </main>
  );
};
