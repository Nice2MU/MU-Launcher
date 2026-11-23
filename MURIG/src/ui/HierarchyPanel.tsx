import React, { useState } from 'react';
import {
  Bone as BoneIcon,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  FolderPlus,
  Layers,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { Bone } from '../core/model/types';
import { selectActiveCharacter, useMurigStore } from '../core/commands/store';

export const HierarchyPanel: React.FC = () => {
  const activeChar = useMurigStore(selectActiveCharacter);
  const selectedBoneId = useMurigStore((s) => s.selectedBoneId);
  const selectedPartId = useMurigStore((s) => s.selectedPartId);
  const selectedPartIds = useMurigStore((s) => s.selectedPartIds);
  const selectedGroupId = useMurigStore((s) => s.selectedGroupId);

  const selectBone = useMurigStore((s) => s.selectBone);
  const selectPart = useMurigStore((s) => s.selectPart);
  const selectGroup = useMurigStore((s) => s.selectGroup);
  const addBone = useMurigStore((s) => s.addBone);
  const deleteBone = useMurigStore((s) => s.deleteBone);
  const clearBones = useMurigStore((s) => s.clearBones);
  const updatePart = useMurigStore((s) => s.updatePart);
  const createPartGroup = useMurigStore((s) => s.createPartGroup);
  const updatePartGroup = useMurigStore((s) => s.updatePartGroup);
  const deletePartGroup = useMurigStore((s) => s.deletePartGroup);
  const assignPartsToGroup = useMurigStore((s) => s.assignPartsToGroup);

  const [dragPartIds, setDragPartIds] = useState<string[]>([]);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const [dragOverUngrouped, setDragOverUngrouped] = useState(false);

  if (!activeChar) {
    return (
      <aside className="panel-left">
        <div className="panel-header">Hierarchy</div>
        <div style={{ padding: 14, color: 'var(--text-muted)' }}>No character loaded</div>
      </aside>
    );
  }

  const boneMap = new Map(activeChar.bones.map((b) => [b.id, b]));
  const childrenMap = new Map<string | null, Bone[]>();
  for (const b of activeChar.bones) {
    const list = childrenMap.get(b.parentId) ?? [];
    list.push(b);
    childrenMap.set(b.parentId, list);
  }

  const renderBoneTree = (parentId: string | null, depth: number): React.ReactNode => {
    const list = childrenMap.get(parentId) ?? [];
    return list.map((bone) => (
      <React.Fragment key={bone.id}>
        <div
          className={`tree-row ${selectedBoneId === bone.id ? 'selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => selectBone(bone.id)}
        >
          <BoneIcon size={12} style={{ color: 'var(--bone-color)', flexShrink: 0 }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {bone.name}
          </span>
          {bone.rotation !== 0 && (
            <span className="badge">{bone.rotation.toFixed(0)}°</span>
          )}
        </div>
        {renderBoneTree(bone.id, depth + 1)}
      </React.Fragment>
    ));
  };

  const partGroups = activeChar.partGroups ?? [];
  const sortedParts = [...activeChar.parts].sort((a, b) => b.z - a.z);
  const ungroupedParts = sortedParts.filter(
    (p) => !p.groupId || !partGroups.some((g) => g.id === p.groupId)
  );

  const handleCreateGroup = () => {
    const defaultName =
      selectedPartIds.length > 0
        ? `Group_${partGroups.length + 1}`
        : `PartGroup_${partGroups.length + 1}`;
    createPartGroup(defaultName, selectedPartIds);
  };

  const renderPartRow = (part: (typeof sortedParts)[number], indent = 0, inGroupId?: string) => {
    const boundBone = boneMap.get(part.boneId);
    const isSelected = selectedPartId === part.id || selectedPartIds.includes(part.id);
    return (
      <div
        key={part.id}
        draggable
        onDragStart={(e) => {
          const ids = selectedPartIds.includes(part.id) ? selectedPartIds : [part.id];
          setDragPartIds(ids);
          e.dataTransfer.setData('text/plain', ids.join(','));
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => {
          setDragPartIds([]);
          setDragOverGroupId(null);
          setDragOverUngrouped(false);
        }}
        className={`tree-row ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + indent }}
        onClick={(e) => selectPart(part.id, e.metaKey || e.ctrlKey || e.shiftKey)}
      >
        <button
          style={{
            background: 'none',
            border: 'none',
            color: part.visible ? 'var(--text-muted)' : 'var(--danger)',
            cursor: 'pointer',
            padding: 0,
            display: 'flex',
          }}
          onClick={(e) => {
            e.stopPropagation();
            updatePart(part.id, { visible: !part.visible });
          }}
          title={part.visible ? 'Hide part' : 'Show part'}
        >
          {part.visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
        <Layers size={12} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            opacity: part.visible ? 1 : 0.45,
          }}
        >
          {part.name}
        </span>
        <span className="badge">z{part.z}{boundBone ? ` · ${boundBone.name}` : ''}</span>
        {inGroupId && (
          <button
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '0 2px',
              display: 'flex',
            }}
            onClick={(e) => {
              e.stopPropagation();
              assignPartsToGroup([part.id], null);
            }}
            title="Remove from group"
          >
            <X size={11} />
          </button>
        )}
        {!inGroupId && selectedGroupId && (
          <button
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              cursor: 'pointer',
              padding: '0 2px',
              display: 'flex',
            }}
            onClick={(e) => {
              e.stopPropagation();
              assignPartsToGroup([part.id], selectedGroupId);
            }}
            title="Add to selected group"
          >
            <Plus size={12} />
          </button>
        )}
      </div>
    );
  };

  return (
    <aside className="panel-left">
      <div className="panel-section" style={{ height: '38%' }}>
        <div className="panel-header">
          <span>Bones ({activeChar.bones.length})</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="btn btn-icon"
              style={{ height: 22 }}
              title="Add Bone (child of selected, or root if none)"
              onClick={() => addBone(selectedBoneId ?? null)}
            >
              <Plus size={12} />
            </button>
            <button
              className="btn btn-icon"
              style={{ height: 22 }}
              title="Delete Selected Bone"
              disabled={!selectedBoneId}
              onClick={() => selectedBoneId && deleteBone(selectedBoneId)}
            >
              <Trash2 size={12} />
            </button>
            <button
              className="btn"
              style={{ height: 22, padding: '0 6px', fontSize: 10 }}
              title="Clear All Bones"
              disabled={activeChar.bones.length === 0}
              onClick={clearBones}
            >
              Clear
            </button>
          </div>
        </div>
        <div className="panel-scroll">
          {activeChar.bones.length === 0 ? (
            <div style={{ padding: 10, color: 'var(--text-muted)', fontSize: 11 }}>
              No bones yet. Click <b>+</b> to add your first bone.
            </div>
          ) : (
            renderBoneTree(null, 0)
          )}
        </div>
      </div>

      <div className="panel-section grow">
        <div className="panel-header">
          <span>Parts & Groups ({activeChar.parts.length})</span>
          <button
            className="btn"
            style={{ height: 22, padding: '0 6px', fontSize: 10 }}
            title="Create Part Group (from selected parts, or empty)"
            onClick={handleCreateGroup}
          >
            <FolderPlus size={12} />
            Group
          </button>
        </div>
        <div className="panel-scroll">
          {partGroups.map((grp) => {
            const members = sortedParts.filter((p) => p.groupId === grp.id);
            const boundBone = boneMap.get(grp.boneId);
            const isSel = selectedGroupId === grp.id;
            return (
              <div key={grp.id} style={{ marginBottom: 4 }}>
                <div
                  className={`tree-row ${isSel ? 'selected' : ''}`}
                  style={{
                    background:
                      dragOverGroupId === grp.id
                        ? 'rgba(79, 143, 247, 0.35)'
                        : isSel
                          ? undefined
                          : 'rgba(79, 143, 247, 0.08)',
                    outline: dragOverGroupId === grp.id ? '1px dashed var(--accent)' : undefined,
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOverGroupId(grp.id);
                  }}
                  onDragLeave={() => setDragOverGroupId(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOverGroupId(null);
                    const raw = e.dataTransfer.getData('text/plain');
                    const ids = dragPartIds.length > 0 ? dragPartIds : raw ? raw.split(',') : [];
                    if (ids.length > 0) assignPartsToGroup(ids, grp.id);
                  }}
                  onClick={() => selectGroup(grp.id)}
                >
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      updatePartGroup(grp.id, { collapsed: !grp.collapsed }, false);
                    }}
                  >
                    {grp.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  </button>
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      color: grp.visible ? 'var(--text-muted)' : 'var(--danger)',
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      updatePartGroup(grp.id, { visible: !grp.visible });
                    }}
                    title="Toggle group visibility"
                  >
                    {grp.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                  <Folder size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {grp.name}
                  </span>
                  <span className="badge">
                    {members.length}p{boundBone ? ` · ${boundBone.name}` : ''}
                  </span>
                  <button
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: '0 2px',
                      display: 'flex',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      deletePartGroup(grp.id);
                    }}
                    title="Ungroup / Delete Group"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
                {!grp.collapsed && members.map((p) => renderPartRow(p, 16, grp.id))}
              </div>
            );
          })}

          <div
            onDragOver={(e) => {
              if (dragPartIds.length > 0) {
                e.preventDefault();
                setDragOverUngrouped(true);
              }
            }}
            onDragLeave={() => setDragOverUngrouped(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverUngrouped(false);
              const raw = e.dataTransfer.getData('text/plain');
              const ids = dragPartIds.length > 0 ? dragPartIds : raw ? raw.split(',') : [];
              if (ids.length > 0) assignPartsToGroup(ids, null);
            }}
            style={{
              minHeight: 40,
              outline: dragOverUngrouped ? '1px dashed var(--text-muted)' : undefined,
              borderRadius: 5,
            }}
          >
            {ungroupedParts.map((part) => renderPartRow(part, 0))}
          </div>
        </div>
      </div>
    </aside>
  );
};
