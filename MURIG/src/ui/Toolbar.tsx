import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  Bone as BoneIcon,
  Eye,
  Film,
  FolderOpen,
  Layers,
  Move,
  Paintbrush,
  Redo2,
  RotateCcw,
  Save,
  Undo2,
  Wand2,
  X,
} from 'lucide-react';
import { importPsdBuffer } from '../core/import/psdImporter';
import { MurigProject } from '../core/model/types';
import { selectActiveCharacter, useMurigStore } from '../core/commands/store';
import { ExportModal } from './ExportModal';

export const Toolbar: React.FC = () => {
  const projInputRef = useRef<HTMLInputElement>(null);

  const project = useMurigStore((s) => s.project);
  const currentProjectPath = useMurigStore((s) => s.currentProjectPath);
  const activeChar = useMurigStore(selectActiveCharacter);
  const [savedNotice, setSavedNotice] = useState(false);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const mode = useMurigStore((s) => s.mode);
  const rigTool = useMurigStore((s) => s.rigTool);
  const brushSize = useMurigStore((s) => s.brushSize);
  const brushMode = useMurigStore((s) => s.brushMode);
  const showBones = useMurigStore((s) => s.showBones);
  const showParts = useMurigStore((s) => s.showParts);
  const canUndo = useMurigStore((s) => s.past.length > 0);
  const canRedo = useMurigStore((s) => s.future.length > 0);

  const loadFromPsdEntries = useMurigStore((s) => s.loadFromPsdEntries);
  const updateFromPsdEntries = useMurigStore((s) => s.updateFromPsdEntries);
  const loadProject = useMurigStore((s) => s.loadProject);
  const closeProject = useMurigStore((s) => s.closeProject);
  const setCurrentProjectPath = useMurigStore((s) => s.setCurrentProjectPath);
  const selectCharacter = useMurigStore((s) => s.selectCharacter);
  const setMode = useMurigStore((s) => s.setMode);
  const setRigTool = useMurigStore((s) => s.setRigTool);
  const setBrushSize = useMurigStore((s) => s.setBrushSize);
  const setBrushMode = useMurigStore((s) => s.setBrushMode);
  const initAutoWeights = useMurigStore((s) => s.initAutoWeights);
  const setShowBones = useMurigStore((s) => s.setShowBones);
  const setShowParts = useMurigStore((s) => s.setShowParts);
  const resetPose = useMurigStore((s) => s.resetPose);
  const undo = useMurigStore((s) => s.undo);
  const redo = useMurigStore((s) => s.redo);

  const handleSaveProject = async (forcePick = false) => {
    if (!project) return;
    const json = JSON.stringify(project, null, 2);
    try {
      let targetPath = forcePick ? null : currentProjectPath;
      if (!targetPath) {
        const picked = await invoke<string | null>('pick_save_project', {
          defaultName: `${project.name || 'character'}.murig.json`,
        });
        if (!picked) return;
        targetPath = picked;
        if (!forcePick) setCurrentProjectPath(targetPath);
      }
      await invoke('write_text_file', { path: targetPath, content: json });
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 1500);
    } catch {
      // Fallback for browser mode
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name || 'character'}.murig.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleOpenAnyClick = async () => {
    try {
      const picked = await invoke<string | null>('pick_open_project');
      if (!picked) return;
      if (/\.psd$/i.test(picked)) {
        const bytes = await invoke<number[]>('read_file_bytes', { path: picked });
        const res = importPsdBuffer(new Uint8Array(bytes));
        const fileName = picked.split('/').pop() ?? 'character.psd';
        const hasMatch =
          project &&
          res.characters.some((e) =>
            project.characters.some((c) => c.name.toLowerCase() === e.name.toLowerCase())
          );
        if (project && hasMatch) {
          const summary = updateFromPsdEntries(res.characters, picked);
          if (summary) {
            setUpdateNotice(`Updated (${summary.updatedParts}${summary.addedParts ? `+${summary.addedParts}` : ''})`);
            setTimeout(() => setUpdateNotice(null), 2000);
          }
        } else {
          loadFromPsdEntries(fileName, res.characters, picked);
        }
      } else {
        const text = await invoke<string>('read_text_file', { path: picked });
        const parsed = JSON.parse(text) as MurigProject;
        if (parsed && parsed.version === 1 && Array.isArray(parsed.characters)) {
          loadProject(parsed, picked);
        }
      }
    } catch {
      projInputRef.current?.click();
    }
  };

  const handleLoadProjectFile = async (file: File) => {
    if (/\.psd$/i.test(file.name)) {
      const buf = await file.arrayBuffer();
      const res = importPsdBuffer(buf);
      const hasMatch =
        project &&
        res.characters.some((e) =>
          project.characters.some((c) => c.name.toLowerCase() === e.name.toLowerCase())
        );
      if (project && hasMatch) {
        const summary = updateFromPsdEntries(res.characters);
        if (summary) {
          setUpdateNotice(`Updated (${summary.updatedParts}${summary.addedParts ? `+${summary.addedParts}` : ''})`);
          setTimeout(() => setUpdateNotice(null), 2000);
        }
      } else {
        loadFromPsdEntries(file.name, res.characters);
      }
      return;
    }
    const text = await file.text();
    const parsed = JSON.parse(text) as MurigProject;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.characters)) {
      loadProject(parsed);
    }
  };

  const handleUpdatePsdMenu = async () => {
    try {
      const picked = await invoke<string | null>('pick_open_psd');
      if (!picked) return;
      const bytes = await invoke<number[]>('read_file_bytes', { path: picked });
      const res = importPsdBuffer(new Uint8Array(bytes));
      const fileName = picked.split('/').pop() ?? 'character.psd';
      if (project) {
        const summary = updateFromPsdEntries(res.characters, picked);
        if (summary) {
          setUpdateNotice(`Updated (${summary.updatedParts}${summary.addedParts ? `+${summary.addedParts}` : ''})`);
          setTimeout(() => setUpdateNotice(null), 2000);
        }
      } else {
        loadFromPsdEntries(fileName, res.characters, picked);
      }
    } catch {
      projInputRef.current?.click();
    }
  };

  const handleSaveRef = useRef(handleSaveProject);
  handleSaveRef.current = handleSaveProject;
  const handleOpenRef = useRef(handleOpenAnyClick);
  handleOpenRef.current = handleOpenAnyClick;
  const handleUpdatePsdRef = useRef(handleUpdatePsdMenu);
  handleUpdatePsdRef.current = handleUpdatePsdMenu;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>('murig://file-menu', (ev) => {
      switch (ev.payload) {
        case 'file_open':
          void handleOpenRef.current();
          break;
        case 'file_update_psd':
          void handleUpdatePsdRef.current();
          break;
        case 'file_save':
          void handleSaveRef.current(false);
          break;
        case 'file_save_as':
          void handleSaveRef.current(true);
          break;
        case 'file_export':
          if (useMurigStore.getState().project) {
            setShowExportModal(true);
          }
          break;
        case 'file_close':
          useMurigStore.getState().closeProject();
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  return (
    <header className="toolbar">
      <div className="brand">
        <BoneIcon size={16} />
        <span>MURIG</span>
      </div>

      <input
        ref={projInputRef}
        type="file"
        accept=".psd,.json,.murig.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleLoadProjectFile(f);
          e.target.value = '';
        }}
      />

      <button
        className="btn btn-primary"
        title="Open .murig.json project or import/update .psd"
        onClick={() => void handleOpenAnyClick()}
      >
        <FolderOpen size={14} />
        {updateNotice ?? 'Open'}
      </button>

      <button className="btn" disabled={!project} onClick={() => void handleSaveProject()}>
        <Save size={14} />
        {savedNotice ? 'Saved!' : 'Save'}
      </button>

      {project && (
        <button
          className="btn"
          title="Close current project"
          onClick={() => closeProject()}
        >
          <X size={14} />
          Close
        </button>
      )}

      {project && project.characters.length > 0 && (
        <>
          <div className="toolbar-sep" />
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Character:</span>
          <select
            className="select-input"
            value={activeChar?.id ?? ''}
            onChange={(e) => selectCharacter(e.target.value)}
          >
            {project.characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.parts.length} parts)
              </option>
            ))}
          </select>
        </>
      )}

      <div className="toolbar-sep" />

      <button
        className={`btn ${mode === 'rig' ? 'btn-active' : ''}`}
        onClick={() => setMode('rig')}
        title="Rig Mode: Move bone joints & paint mesh weights"
      >
        <Move size={14} />
        Rig
      </button>
      {mode === 'rig' && (
        <>
          <button
            className={`btn ${rigTool === 'weight' ? 'btn-active' : ''}`}
            onClick={() => setRigTool(rigTool === 'weight' ? 'select' : 'weight')}
            title="Unity-style Weight Brush: Select a bone and paint on the mesh"
          >
            <Paintbrush size={14} />
            Weight Brush
          </button>
          {rigTool === 'weight' && (
            <>
              <button
                className={`btn ${brushMode === 'add' ? 'btn-active' : ''}`}
                style={{ padding: '0 7px', fontSize: 11 }}
                onClick={() => setBrushMode(brushMode === 'add' ? 'erase' : 'add')}
                title="Toggle Add / Erase (or hold Alt)"
              >
                {brushMode === 'add' ? '+ Add' : '- Erase'}
              </button>
              <input
                type="range"
                min={30}
                max={350}
                value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                title={`Brush Size: ${brushSize}px`}
                style={{ width: 65, accentColor: 'var(--accent)' }}
              />
              <button
                className="btn"
                style={{ padding: '0 7px', fontSize: 11 }}
                onClick={() => initAutoWeights()}
                title="Regenerate Auto Weights"
              >
                <Wand2 size={12} />
                Auto
              </button>
            </>
          )}
        </>
      )}
      <button
        className={`btn ${mode === 'pose' ? 'btn-active' : ''}`}
        onClick={() => setMode('pose')}
        title="Pose Mode: Rotate bones & test parameters"
      >
        <BoneIcon size={14} />
        Pose / Test
      </button>
      <button
        className={`btn ${mode === 'animate' ? 'btn-active' : ''}`}
        onClick={() => setMode('animate')}
        title="Animate Mode: Keyframe timeline & presets"
      >
        <Film size={14} />
        Animate
      </button>

      <div className="toolbar-sep" />

      <button
        className={`btn btn-icon ${showBones ? 'btn-active' : ''}`}
        onClick={() => setShowBones(!showBones)}
        title="Toggle Bone Overlay"
      >
        <BoneIcon size={14} />
      </button>
      <button
        className={`btn btn-icon ${showParts ? 'btn-active' : ''}`}
        onClick={() => setShowParts(!showParts)}
        title="Toggle Parts"
      >
        <Layers size={14} />
      </button>

      <div className="toolbar-sep" />

      <button className="btn btn-icon" disabled={!canUndo} onClick={undo} title="Undo">
        <Undo2 size={14} />
      </button>
      <button className="btn btn-icon" disabled={!canRedo} onClick={redo} title="Redo">
        <Redo2 size={14} />
      </button>

      <button className="btn" disabled={!project} onClick={resetPose} title="Reset Pose & Params">
        <RotateCcw size={14} />
        Reset Pose
      </button>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        {activeChar && (
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            <Eye size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            {activeChar.canvasWidth}×{activeChar.canvasHeight}
          </span>
        )}
      </div>
      {showExportModal && activeChar && (
        <ExportModal character={activeChar} onClose={() => setShowExportModal(false)} />
      )}
    </header>
  );
};
