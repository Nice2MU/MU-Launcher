import React, { useRef } from 'react';
import {
  KeyRound,
  Pause,
  Play,
  Plus,
  Repeat,
  SkipBack,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { selectActiveCharacter, useMurigStore } from '../core/commands/store';

export const TimelinePanel: React.FC = () => {
  const rulerRef = useRef<HTMLDivElement>(null);

  const activeChar = useMurigStore(selectActiveCharacter);
  const activeClipId = useMurigStore((s) => s.activeClipId);
  const currentTime = useMurigStore((s) => s.currentTime);
  const isPlaying = useMurigStore((s) => s.isPlaying);
  const autoKey = useMurigStore((s) => s.autoKey);

  const createClip = useMurigStore((s) => s.createClip);
  const selectClip = useMurigStore((s) => s.selectClip);
  const deleteClip = useMurigStore((s) => s.deleteClip);
  const updateClip = useMurigStore((s) => s.updateClip);
  const setCurrentTime = useMurigStore((s) => s.setCurrentTime);
  const setIsPlaying = useMurigStore((s) => s.setIsPlaying);
  const setAutoKey = useMurigStore((s) => s.setAutoKey);
  const keyCurrentPose = useMurigStore((s) => s.keyCurrentPose);
  const deleteKeyframe = useMurigStore((s) => s.deleteKeyframe);
  const applyAnimPreset = useMurigStore((s) => s.applyAnimPreset);

  if (!activeChar) return null;

  const clips = activeChar.clips ?? [];
  const activeClip = clips.find((c) => c.id === activeClipId) ?? clips[0];
  const duration = activeClip?.duration ?? 2.0;
  const boneMap = new Map(activeChar.bones.map((b) => [b.id, b]));

  const scrubFromClientX = (clientX: number) => {
    const el = rulerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setIsPlaying(false);
    setCurrentTime(Math.round(ratio * duration * 100) / 100);
  };

  const startScrub = (e: React.PointerEvent) => {
    scrubFromClientX(e.clientX);
    const onMove = (ev: PointerEvent) => scrubFromClientX(ev.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const playheadPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <section
      style={{
        height: 210,
        background: 'var(--bg-panel)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* Timeline Toolbar */}
      <div
        style={{
          height: 36,
          padding: '0 10px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-panel-alt)',
        }}
      >
        <button
          className="btn btn-icon"
          onClick={() => {
            setIsPlaying(false);
            setCurrentTime(0);
          }}
          title="Rewind"
        >
          <SkipBack size={13} />
        </button>
        <button
          className={`btn btn-icon ${isPlaying ? 'btn-primary' : ''}`}
          disabled={!activeClip}
          onClick={() => setIsPlaying(!isPlaying)}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={13} /> : <Play size={13} />}
        </button>

        <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 88, color: 'var(--text-muted)' }}>
          {currentTime.toFixed(2)}s / {duration.toFixed(2)}s
        </span>

        {activeClip && (
          <button
            className={`btn btn-icon ${activeClip.loop ? 'btn-active' : ''}`}
            onClick={() => updateClip(activeClip.id, { loop: !activeClip.loop })}
            title="Toggle Loop"
          >
            <Repeat size={13} />
          </button>
        )}

        <div className="toolbar-sep" />

        <select
          className="select-input"
          value={activeClip?.id ?? ''}
          onChange={(e) => selectClip(e.target.value || null)}
        >
          {clips.length === 0 && <option value="">(No Clips)</option>}
          {clips.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.duration}s)
            </option>
          ))}
        </select>

        <button className="btn" onClick={() => createClip()} title="New Animation Clip">
          <Plus size={12} />
          Clip
        </button>

        {activeClip && (
          <button
            className="btn btn-icon"
            onClick={() => deleteClip(activeClip.id)}
            title="Delete Clip"
          >
            <Trash2 size={12} />
          </button>
        )}

        <div className="toolbar-sep" />

        <button
          className="btn"
          onClick={keyCurrentPose}
          title="Insert keyframes for current pose at playhead"
        >
          <KeyRound size={12} />
          Key Pose
        </button>
        <button
          className={`btn ${autoKey ? 'btn-active' : ''}`}
          onClick={() => setAutoKey(!autoKey)}
          title="Auto-Key: rotating a bone in Animate mode automatically records a keyframe"
        >
          Auto-Key
        </button>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Sparkles size={12} style={{ color: 'var(--accent)' }} />
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Presets:</span>
          <button className="btn" onClick={() => applyAnimPreset('idle')}>
            Idle
          </button>
          <button className="btn" onClick={() => applyAnimPreset('wave')}>
            Wave
          </button>
          <button className="btn" onClick={() => applyAnimPreset('nod')}>
            Nod
          </button>
        </div>
      </div>

      {/* Dopesheet Area */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left Track Labels */}
        <div
          style={{
            width: 200,
            borderRight: '1px solid var(--border)',
            overflowY: 'auto',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              height: 22,
              padding: '0 8px',
              fontSize: 10,
              color: 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              borderBottom: '1px solid var(--border)',
            }}
          >
            TRACKS ({activeClip?.tracks.length ?? 0})
          </div>
          {(activeClip?.tracks ?? []).map((tr) => {
            const label =
              tr.targetType === 'bone'
                ? boneMap.get(tr.targetId)?.name ?? tr.targetId
                : tr.targetId;
            return (
              <div
                key={tr.id}
                style={{
                  height: 24,
                  padding: '0 8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderBottom: '1px solid rgba(255,255,255,0.03)',
                  fontSize: 11,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {label}
                </span>
                <span className="badge">{tr.prop}</span>
              </div>
            );
          })}
        </div>

        {/* Right Timeline Ruler & Keyframes */}
        <div style={{ flex: 1, position: 'relative', overflowY: 'auto', overflowX: 'hidden' }}>
          {/* Time Ruler */}
          <div
            ref={rulerRef}
            onPointerDown={startScrub}
            style={{
              height: 22,
              background: 'var(--bg-app)',
              borderBottom: '1px solid var(--border)',
              position: 'relative',
              cursor: 'ew-resize',
            }}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((r) => (
              <span
                key={r}
                style={{
                  position: 'absolute',
                  left: `${r * 100}%`,
                  transform: r === 1 ? 'translateX(-100%)' : r === 0 ? 'none' : 'translateX(-50%)',
                  top: 4,
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  padding: '0 4px',
                }}
              >
                {(r * duration).toFixed(1)}s
              </span>
            ))}
          </div>

          {/* Tracks Keyframes */}
          {(activeClip?.tracks ?? []).map((tr) => (
            <div
              key={tr.id}
              style={{
                height: 24,
                position: 'relative',
                borderBottom: '1px solid rgba(255,255,255,0.03)',
              }}
            >
              {tr.keys.map((k, idx) => {
                const pct = duration > 0 ? (k.t / duration) * 100 : 0;
                return (
                  <div
                    key={idx}
                    title={`${k.t.toFixed(2)}s = ${k.v.toFixed(2)} (Click: jump, Right-click: delete)`}
                    onClick={() => {
                      setIsPlaying(false);
                      setCurrentTime(k.t);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      deleteKeyframe(tr.id, k.t);
                    }}
                    style={{
                      position: 'absolute',
                      left: `${pct}%`,
                      top: 7,
                      width: 9,
                      height: 9,
                      background: 'var(--bone-selected)',
                      transform: 'translateX(-50%) rotate(45deg)',
                      cursor: 'pointer',
                      border: '1px solid #121418',
                    }}
                  />
                );
              })}
            </div>
          ))}

          {(!activeClip || activeClip.tracks.length === 0) && (
            <div style={{ padding: 14, color: 'var(--text-muted)', fontSize: 11 }}>
              Click <b>Idle / Wave / Nod</b> preset, or scrub the ruler and rotate bones with <b>Auto-Key</b> enabled!
            </div>
          )}

          {/* Playhead Vertical Line */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${playheadPct}%`,
              width: 1.5,
              background: 'var(--accent)',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>
    </section>
  );
};
