import React, { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Toolbar } from './ui/Toolbar';
import { HierarchyPanel } from './ui/HierarchyPanel';
import { ViewportCanvas } from './ui/ViewportCanvas';
import { InspectorPanel } from './ui/InspectorPanel';
import { TimelinePanel } from './ui/TimelinePanel';
import { initMcpBridge } from './core/mcp/mcpBridge';
import { selectActiveCharacter, useMurigStore } from './core/commands/store';

export const App: React.FC = () => {
  const mode = useMurigStore((s) => s.mode);
  const activeChar = useMurigStore(selectActiveCharacter);
  const undo = useMurigStore((s) => s.undo);
  const redo = useMurigStore((s) => s.redo);
  const [mcpLog, setMcpLog] = useState<string>('MCP ● 127.0.0.1:7820');

  useEffect(() => {
    const stopMcp = initMcpBridge((msg) => setMcpLog(`MCP ● ${msg.replace(/\/mcp\b/g, '')}`));
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);

    let unlistenUndo: (() => void) | undefined;
    let unlistenRedo: (() => void) | undefined;
    void listen('murig://undo', () => useMurigStore.getState().undo())
      .then((fn) => {
        unlistenUndo = fn;
      })
      .catch(() => {});
    void listen('murig://redo', () => useMurigStore.getState().redo())
      .then((fn) => {
        unlistenRedo = fn;
      })
      .catch(() => {});

    return () => {
      stopMcp();
      window.removeEventListener('keydown', onKeyDown, true);
      unlistenUndo?.();
      unlistenRedo?.();
    };
  }, [undo, redo]);

  return (
    <div className="app-shell">
      <Toolbar />
      <div className="workspace">
        <HierarchyPanel />
        <ViewportCanvas />
        <InspectorPanel />
      </div>
      {mode === 'animate' && <TimelinePanel />}
      <footer className="statusbar">
        <span>
          {activeChar
            ? `${activeChar.name} — ${activeChar.bones.length} bones, ${activeChar.parts.length} parts`
            : 'MURig v1.0.1'}
        </span>
        <span style={{ color: 'var(--success)' }}>{mcpLog}</span>
      </footer>
    </div>
  );
};

export default App;
