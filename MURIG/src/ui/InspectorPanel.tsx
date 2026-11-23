import React from 'react';
import { RotateCcw } from 'lucide-react';
import { selectActiveCharacter, useMurigStore } from '../core/commands/store';

export const InspectorPanel: React.FC = () => {
  const activeChar = useMurigStore(selectActiveCharacter);
  const selectedBoneId = useMurigStore((s) => s.selectedBoneId);
  const selectedPartId = useMurigStore((s) => s.selectedPartId);
  const selectedGroupId = useMurigStore((s) => s.selectedGroupId);
  const updateBone = useMurigStore((s) => s.updateBone);
  const updatePart = useMurigStore((s) => s.updatePart);
  const updatePartGroup = useMurigStore((s) => s.updatePartGroup);
  const assignPartsToGroup = useMurigStore((s) => s.assignPartsToGroup);
  const setParamValue = useMurigStore((s) => s.setParamValue);
  const resetPose = useMurigStore((s) => s.resetPose);

  if (!activeChar) {
    return (
      <aside className="panel-right">
        <div className="panel-header">Inspector</div>
        <div style={{ padding: 14, color: 'var(--text-muted)' }}>No character loaded</div>
      </aside>
    );
  }

  const partGroups = activeChar.partGroups ?? [];
  const selectedBone = activeChar.bones.find((b) => b.id === selectedBoneId);
  const selectedPart = activeChar.parts.find((p) => p.id === selectedPartId);
  const selectedGroup = partGroups.find((g) => g.id === selectedGroupId);

  return (
    <aside className="panel-right">
      <div className="panel-section" style={{ maxHeight: '58%' }}>
        <div className="panel-header">
          <span>
            {selectedBone
              ? `Bone: ${selectedBone.name}`
              : selectedGroup
                ? `Group: ${selectedGroup.name}`
                : selectedPart
                  ? `Part: ${selectedPart.name}`
                  : 'Properties'}
          </span>
        </div>
        <div className="panel-scroll">
          {selectedBone && (
            <div className="prop-grid">
              <span className="prop-label">Name</span>
              <input
                className="text-input"
                value={selectedBone.name}
                onChange={(e) => updateBone(selectedBone.id, { name: e.target.value })}
              />

              <span className="prop-label">Parent</span>
              <select
                className="select-input"
                value={selectedBone.parentId ?? ''}
                onChange={(e) =>
                  updateBone(selectedBone.id, { parentId: e.target.value || null })
                }
              >
                <option value="">(None / Root)</option>
                {activeChar.bones
                  .filter((b) => b.id !== selectedBone.id)
                  .map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>

              <span className="prop-label">X / Y</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  type="number"
                  className="num-input"
                  style={{ width: '50%' }}
                  value={Math.round(selectedBone.x)}
                  onChange={(e) => updateBone(selectedBone.id, { x: Number(e.target.value) })}
                />
                <input
                  type="number"
                  className="num-input"
                  style={{ width: '50%' }}
                  value={Math.round(selectedBone.y)}
                  onChange={(e) => updateBone(selectedBone.id, { y: Number(e.target.value) })}
                />
              </div>

              <span className="prop-label">Rotation</span>
              <input
                type="number"
                className="num-input"
                step={1}
                value={Number(selectedBone.rotation.toFixed(1))}
                onChange={(e) => updateBone(selectedBone.id, { rotation: Number(e.target.value) })}
              />

              <span className="prop-label">Scale X/Y</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  type="number"
                  className="num-input"
                  style={{ width: '50%' }}
                  step={0.05}
                  value={Number(selectedBone.scaleX.toFixed(2))}
                  onChange={(e) => updateBone(selectedBone.id, { scaleX: Number(e.target.value) })}
                />
                <input
                  type="number"
                  className="num-input"
                  style={{ width: '50%' }}
                  step={0.05}
                  value={Number(selectedBone.scaleY.toFixed(2))}
                  onChange={(e) => updateBone(selectedBone.id, { scaleY: Number(e.target.value) })}
                />
              </div>

              <span className="prop-label">Length</span>
              <input
                type="number"
                className="num-input"
                min={20}
                value={Math.round(selectedBone.length)}
                onChange={(e) => updateBone(selectedBone.id, { length: Math.max(20, Number(e.target.value)) })}
              />

              <span className="prop-label" style={{ gridColumn: '1 / -1', marginTop: 6, fontWeight: 600 }}>
                Linked Layers ({activeChar.parts.filter((p) => p.boneId === selectedBone.id).length})
              </span>
              <div
                style={{
                  gridColumn: '1 / -1',
                  maxHeight: 150,
                  overflowY: 'auto',
                  background: 'var(--bg-app)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: 4,
                }}
              >
                {partGroups.map((g) => {
                  const isLinked = g.boneId === selectedBone.id;
                  return (
                    <label
                      key={g.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 5px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        background: isLinked ? 'rgba(79, 143, 247, 0.18)' : 'rgba(79, 143, 247, 0.06)',
                        marginBottom: 2,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isLinked}
                        onChange={() =>
                          updatePartGroup(g.id, { boneId: isLinked ? '' : selectedBone.id })
                        }
                      />
                      <span style={{ fontWeight: 600, flex: 1 }}>[Group] {g.name}</span>
                      <span className="badge">
                        {activeChar.parts.filter((p) => p.groupId === g.id).length}p
                      </span>
                    </label>
                  );
                })}
                {[...activeChar.parts]
                  .sort((a, b) => {
                    const aLinked = a.boneId === selectedBone.id ? 0 : 1;
                    const bLinked = b.boneId === selectedBone.id ? 0 : 1;
                    return aLinked - bLinked || b.z - a.z;
                  })
                  .map((p) => {
                    const isLinked = p.boneId === selectedBone.id;
                    const otherBone = !isLinked
                      ? activeChar.bones.find((b) => b.id === p.boneId)?.name ?? 'Unlinked'
                      : null;
                    return (
                      <label
                        key={p.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 5px',
                          borderRadius: 4,
                          cursor: 'pointer',
                          background: isLinked ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isLinked}
                          onChange={() =>
                            updatePart(p.id, { boneId: isLinked ? '' : selectedBone.id })
                          }
                        />
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                          }}
                        >
                          {p.name}
                        </span>
                        {otherBone && <span className="badge">{otherBone}</span>}
                      </label>
                    );
                  })}
              </div>
            </div>
          )}

          {selectedGroup && (
            <div className="prop-grid">
              <span className="prop-label">Name</span>
              <input
                className="text-input"
                value={selectedGroup.name}
                onChange={(e) => updatePartGroup(selectedGroup.id, { name: e.target.value })}
              />

              <span className="prop-label">Bone</span>
              <select
                className="select-input"
                value={selectedGroup.boneId}
                onChange={(e) => updatePartGroup(selectedGroup.id, { boneId: e.target.value })}
              >
                <option value="">(Unlinked)</option>
                {activeChar.bones.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>

              <span className="prop-label">Pivot X/Y</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  type="number"
                  className="num-input"
                  style={{ width: '50%' }}
                  value={Math.round(selectedGroup.pivot.x)}
                  onChange={(e) =>
                    updatePartGroup(selectedGroup.id, {
                      pivot: { ...selectedGroup.pivot, x: Number(e.target.value) },
                    })
                  }
                />
                <input
                  type="number"
                  className="num-input"
                  style={{ width: '50%' }}
                  value={Math.round(selectedGroup.pivot.y)}
                  onChange={(e) =>
                    updatePartGroup(selectedGroup.id, {
                      pivot: { ...selectedGroup.pivot, y: Number(e.target.value) },
                    })
                  }
                />
              </div>

              <span className="prop-label">Skinning</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(selectedGroup.skinned)}
                  onChange={(e) => updatePartGroup(selectedGroup.id, { skinned: e.target.checked })}
                />
                <span style={{ fontSize: 11 }}>Smooth Mesh Bend (All)</span>
              </label>

              <span className="prop-label" style={{ gridColumn: '1 / -1', marginTop: 6, fontWeight: 600 }}>
                Group Members ({activeChar.parts.filter((p) => p.groupId === selectedGroup.id).length})
              </span>
              <div
                style={{
                  gridColumn: '1 / -1',
                  maxHeight: 170,
                  overflowY: 'auto',
                  background: 'var(--bg-app)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: 4,
                }}
              >
                {[...activeChar.parts]
                  .sort((a, b) => {
                    const aIn = a.groupId === selectedGroup.id ? 0 : 1;
                    const bIn = b.groupId === selectedGroup.id ? 0 : 1;
                    return aIn - bIn || b.z - a.z;
                  })
                  .map((p) => {
                    const isIn = p.groupId === selectedGroup.id;
                    const otherGrp = !isIn && p.groupId
                      ? partGroups.find((g) => g.id === p.groupId)?.name
                      : null;
                    return (
                      <label
                        key={p.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 5px',
                          borderRadius: 4,
                          cursor: 'pointer',
                          background: isIn ? 'rgba(79, 143, 247, 0.14)' : 'transparent',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isIn}
                          onChange={() =>
                            assignPartsToGroup([p.id], isIn ? null : selectedGroup.id)
                          }
                        />
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            flex: 1,
                          }}
                        >
                          {p.name}
                        </span>
                        <span className="badge">
                          z{p.z}{otherGrp ? ` · ${otherGrp}` : ''}
                        </span>
                      </label>
                    );
                  })}
              </div>
            </div>
          )}

          {selectedPart && (
            <div className="prop-grid">
              <span className="prop-label">Name</span>
              <input
                className="text-input"
                value={selectedPart.name}
                onChange={(e) => updatePart(selectedPart.id, { name: e.target.value })}
              />

              <span className="prop-label">Group</span>
              <select
                className="select-input"
                value={selectedPart.groupId ?? ''}
                onChange={(e) =>
                  assignPartsToGroup([selectedPart.id], e.target.value || null)
                }
              >
                <option value="">(None)</option>
                {partGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>

              <span className="prop-label">Bone</span>
              <select
                className="select-input"
                value={selectedPart.boneId}
                onChange={(e) => updatePart(selectedPart.id, { boneId: e.target.value })}
              >
                <option value="">(Unlinked)</option>
                {activeChar.bones.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>

              <span className="prop-label">Pivot X/Y</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <input
                  type="number"
                  className="num-input"
                  style={{ width: '50%' }}
                  value={Math.round(selectedPart.pivot.x)}
                  onChange={(e) =>
                    updatePart(selectedPart.id, {
                      pivot: { ...selectedPart.pivot, x: Number(e.target.value) },
                    })
                  }
                />
                <input
                  type="number"
                  className="num-input"
                  style={{ width: '50%' }}
                  value={Math.round(selectedPart.pivot.y)}
                  onChange={(e) =>
                    updatePart(selectedPart.id, {
                      pivot: { ...selectedPart.pivot, y: Number(e.target.value) },
                    })
                  }
                />
              </div>

              <span className="prop-label">Parallax</span>
              <input
                type="range"
                className="slider-input"
                min={-0.6}
                max={1}
                step={0.05}
                value={selectedPart.parallax}
                onChange={(e) => updatePart(selectedPart.id, { parallax: Number(e.target.value) })}
              />

              <span className="prop-label">Draw Order</span>
              <input
                type="number"
                className="num-input"
                value={selectedPart.z}
                onChange={(e) => updatePart(selectedPart.id, { z: Number(e.target.value) })}
              />

              <span className="prop-label">Opacity</span>
              <input
                type="range"
                className="slider-input"
                min={0}
                max={1}
                step={0.05}
                value={selectedPart.alpha}
                onChange={(e) => updatePart(selectedPart.id, { alpha: Number(e.target.value) })}
              />

              <span className="prop-label">Skinning</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(selectedPart.skinned)}
                  onChange={(e) => updatePart(selectedPart.id, { skinned: e.target.checked })}
                />
                <span style={{ fontSize: 11 }}>Smooth Mesh Bend</span>
              </label>
            </div>
          )}

          {!selectedBone && !selectedPart && !selectedGroup && (
            <div style={{ padding: 10, color: 'var(--text-muted)' }}>
              Select a bone, group, or part to inspect properties.
            </div>
          )}
        </div>
      </div>

      <div className="panel-section grow">
        <div className="panel-header">
          <span>L2D Parameters</span>
          <button
            className="btn btn-icon"
            style={{ height: 22 }}
            onClick={resetPose}
            title="Reset all parameters"
          >
            <RotateCcw size={12} />
          </button>
        </div>
        <div className="panel-scroll">
          {activeChar.params.map((param) => (
            <div key={param.id} className="slider-row">
              <div className="slider-header">
                <span>{param.name}</span>
                <span style={{ color: 'var(--text-muted)' }}>{param.value.toFixed(2)}</span>
              </div>
              <input
                type="range"
                className="slider-input"
                min={param.min}
                max={param.max}
                step={0.01}
                value={param.value}
                onDoubleClick={() => setParamValue(param.id, param.defaultValue)}
                onChange={(e) => setParamValue(param.id, Number(e.target.value))}
              />
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};
