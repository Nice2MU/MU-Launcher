import React, { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, Download, FolderOutput, X } from 'lucide-react';
import { Character } from '../core/model/types';
import {
  buildUnityRigExport,
  canvasToPngBytes,
  packAtlasRegions,
  renderAtlasCanvas,
  sanitizeFileName,
} from '../core/export/unityExport';

interface ExportModalProps {
  character: Character;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ character, onClose }) => {
  const [exportName, setExportName] = useState(character.name || 'Character');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(character.parts.filter((p) => p.visible).map((p) => p.id))
  );
  const [exporting, setExporting] = useState(false);
  const [atlasPreviewUrl, setAtlasPreviewUrl] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const safeName = useMemo(() => sanitizeFileName(exportName), [exportName]);

  const selectedParts = useMemo(
    () => character.parts.filter((p) => selectedIds.has(p.id)),
    [character.parts, selectedIds]
  );

  const atlasPack = useMemo(
    () => packAtlasRegions(selectedParts, 4),
    [selectedParts]
  );

  useEffect(() => {
    if (selectedParts.length === 0) {
      setAtlasPreviewUrl(null);
      return;
    }
    let cancelled = false;
    renderAtlasCanvas(selectedParts, atlasPack)
      .then((canvas) => {
        if (!cancelled) {
          setAtlasPreviewUrl(canvas.toDataURL('image/png'));
        }
      })
      .catch(() => {
        if (!cancelled) setAtlasPreviewUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedParts, atlasPack]);

  const togglePart = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExport = async () => {
    if (selectedIds.size === 0 || exporting) return;
    setErrorMsg(null);
    setResultMsg(null);
    setExporting(true);
    try {
      const folder = await invoke<string | null>('pick_export_folder');
      if (!folder) {
        setExporting(false);
        return;
      }
      const cleanFolder = folder.replace(/\/+$/, '');
      const baseDir = `${cleanFolder}/${safeName}`;
      const bundle = buildUnityRigExport(character, {
        exportName: safeName,
        selectedPartIds: Array.from(selectedIds),
        includeMeshWeights: true,
        includeClips: true,
        atlasMode: true,
      });

      const canvas = await renderAtlasCanvas(selectedParts, atlasPack);
      const pngBytes = await canvasToPngBytes(canvas);
      await invoke('write_binary_file', {
        path: `${baseDir}/${bundle.exportName}.png`,
        bytes: Array.from(pngBytes),
      });
      await invoke('write_text_file', {
        path: `${baseDir}/${bundle.exportName}.atlas`,
        content: bundle.atlasText,
      });
      await invoke('write_text_file', {
        path: `${baseDir}/${bundle.exportName}.rig.json`,
        content: bundle.rigJson,
      });
      setResultMsg(
        `Exported ${bundle.exportName}.png (${bundle.atlasWidth}×${bundle.atlasHeight}), ${bundle.exportName}.atlas & ${bundle.exportName}.rig.json to ${baseDir}`
      );
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FolderOutput size={16} color="var(--accent)" />
            <span>Export — {character.name}</span>
          </div>
          <button className="btn btn-icon" onClick={onClose} title="Close">
            <X size={14} />
          </button>
        </div>

        <div className="modal-body">
          <div className="export-row">
            <label className="export-label">
              Export Name
              <input
                type="text"
                className="export-input"
                value={exportName}
                onChange={(e) => setExportName(e.target.value)}
                placeholder={character.name}
              />
            </label>
            <div className="export-preview-path">
              <div>
                Output: <code>{safeName}/{safeName}.png</code> +{' '}
                <code>{safeName}.atlas</code> + <code>{safeName}.rig.json</code>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                {character.bones.length} bones • {selectedIds.size}/{character.parts.length} parts •{' '}
                {(character.clips ?? []).length} clips
                {selectedIds.size > 0
                  ? ` • Atlas ${atlasPack.atlasWidth}×${atlasPack.atlasHeight} px`
                  : ''}
              </div>
            </div>
          </div>

          <div className="export-split">
            <div className="export-tex-grid">
              {character.parts.map((part) => {
                const checked = selectedIds.has(part.id);
                return (
                  <div
                    key={part.id}
                    className={`export-tex-card ${checked ? 'selected' : ''}`}
                    onClick={() => togglePart(part.id)}
                  >
                    <div className="export-tex-thumb">
                      {part.imageDataUrl && <img src={part.imageDataUrl} alt={part.name} />}
                      <span className={`export-tex-check ${checked ? 'on' : ''}`}>
                        {checked && <Check size={11} />}
                      </span>
                    </div>
                    <div className="export-tex-meta">
                      <div className="export-tex-name" title={part.name}>
                        {part.name}
                      </div>
                      <div className="export-tex-size">
                        {part.w}×{part.h}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="export-atlas-pane">
              <div className="export-atlas-header">
                <span>Atlas Preview ({safeName}.png)</span>
                <span>
                  {selectedIds.size > 0
                    ? `${atlasPack.atlasWidth} × ${atlasPack.atlasHeight}`
                    : 'Empty'}
                </span>
              </div>
              <div className="export-atlas-canvas-wrap">
                {atlasPreviewUrl ? (
                  <img src={atlasPreviewUrl} alt={`${safeName} Texture Atlas`} />
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                    Select parts to preview atlas
                  </span>
                )}
              </div>
            </div>
          </div>

          {resultMsg && <div className="export-banner ok">{resultMsg}</div>}
          {errorMsg && <div className="export-banner err">{errorMsg}</div>}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={selectedIds.size === 0 || exporting}
            onClick={() => void handleExport()}
          >
            <Download size={14} />
            {exporting ? 'Exporting...' : `Export Atlas (${selectedIds.size} parts)`}
          </button>
        </div>
      </div>
    </div>
  );
};
