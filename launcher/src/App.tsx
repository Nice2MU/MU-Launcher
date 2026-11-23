import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  FolderOpen,
  Play,
  Plus,
  Search,
  Square,
  Star,
  Trash2,
} from 'lucide-react';
import launcherIcon from '../src-tauri/icons/icon.png';

interface DiscoveredApp {
  name: string;
  path: string;
  running: boolean;
  mcpPort: number | null;
  mcpOnline: boolean;
  iconDataUrl?: string | null;
}

interface SavedAppMeta {
  name: string;
  path: string;
  category: string;
  description: string;
  pinned: boolean;
  custom?: boolean;
  mcpPort?: number | null;
}

interface LauncherApp extends SavedAppMeta {
  running: boolean;
  mcpOnline: boolean;
  iconDataUrl?: string | null;
}

const DEFAULT_META: Record<string, Partial<SavedAppMeta>> = {
  MURig: {
    category: 'Rigging & Animation',
    description: '2D PSD Character Rigging, Mesh Skinning & Animation Studio.',
    pinned: true,
    mcpPort: 7820,
  },
};

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #ea580c, #c2410c)',
  'linear-gradient(135deg, #d97706, #b45309)',
  'linear-gradient(135deg, #16a34a, #15803d)',
  'linear-gradient(135deg, #e11d48, #be123c)',
  'linear-gradient(135deg, #7c2d12, #9a3412)',
];

function avatarGradient(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
}

export default function App() {
  const [apps, setApps] = useState<LauncherApp[]>([]);
  const [hubRoot, setHubRoot] = useState('/Users/nice2mu/Desktop/MU Launcher');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'all' | 'pinned' | 'running'>('all');
  const [loading, setLoading] = useState(true);

  const persistMeta = useCallback(async (list: LauncherApp[]) => {
    const saved: SavedAppMeta[] = list.map((a) => ({
      name: a.name,
      path: a.path,
      category: a.category,
      description: a.description,
      pinned: a.pinned,
      custom: a.custom,
      mcpPort: a.mcpPort ?? null,
    }));
    try {
      await invoke('save_registry', { content: JSON.stringify({ apps: saved }, null, 2) });
    } catch {
      // ignore in browser preview
    }
  }, []);

  const refreshApps = useCallback(async () => {
    try {
      const [root, discovered, rawReg] = await Promise.all([
        invoke<string>('get_hub_root'),
        invoke<DiscoveredApp[]>('scan_launcher_apps'),
        invoke<string>('load_registry'),
      ]);
      setHubRoot(root);

      let savedList: SavedAppMeta[] = [];
      if (rawReg) {
        try {
          const parsed = JSON.parse(rawReg);
          if (Array.isArray(parsed.apps)) savedList = parsed.apps;
        } catch {
          // ignore corrupt json
        }
      }

      const savedByPath = new Map(savedList.map((s) => [s.path, s]));
      const merged: LauncherApp[] = [];
      const seenPaths = new Set<string>();

      for (const d of discovered) {
        seenPaths.add(d.path);
        const s = savedByPath.get(d.path);
        const def = DEFAULT_META[d.name];
        merged.push({
          name: s?.name ?? d.name,
          path: d.path,
          category: s?.category ?? def?.category ?? 'App',
          description: s?.description ?? def?.description ?? 'Local macOS application in MU Launcher.',
          pinned: s?.pinned ?? def?.pinned ?? false,
          custom: false,
          mcpPort: s?.mcpPort ?? d.mcpPort ?? def?.mcpPort ?? null,
          running: d.running,
          mcpOnline: d.mcpOnline,
          iconDataUrl: d.iconDataUrl ?? null,
        });
      }

      // Add custom apps registered outside the scanned folder
      for (const s of savedList) {
        if (s.custom && !seenPaths.has(s.path)) {
          const [running, mcpOnline] = await invoke<[boolean, boolean]>('check_app_status', {
            name: s.name,
            mcpPort: s.mcpPort ?? null,
          });
          merged.push({
            ...s,
            running,
            mcpOnline,
          });
        }
      }

      merged.sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
      setApps((prev) => {
        if (
          prev.length === merged.length &&
          prev.every((p, i) => {
            const n = merged[i];
            return (
              p.path === n.path &&
              p.name === n.name &&
              p.running === n.running &&
              p.mcpOnline === n.mcpOnline &&
              p.pinned === n.pinned &&
              p.category === n.category &&
              p.mcpPort === n.mcpPort &&
              p.iconDataUrl === n.iconDataUrl
            );
          })
        ) {
          return prev;
        }
        return merged;
      });
    } catch (e) {
      console.error('Failed to scan apps:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshApps();
    const timer = setInterval(() => {
      if (!document.hidden) {
        void refreshApps();
      }
    }, 3000);
    const onVis = () => {
      if (!document.hidden) void refreshApps();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [refreshApps]);

  const handleLaunch = async (app: LauncherApp) => {
    await invoke('launch_app', { path: app.path });
    setTimeout(() => void refreshApps(), 700);
  };

  const handleQuit = async (app: LauncherApp) => {
    await invoke('quit_app', { name: app.name });
    setTimeout(() => void refreshApps(), 500);
  };

  const handleReveal = async (app: LauncherApp) => {
    await invoke('reveal_in_finder', { path: app.path });
  };

  const handleTogglePin = async (app: LauncherApp) => {
    const next = apps
      .map((a) => (a.path === app.path ? { ...a, pinned: !a.pinned } : a))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
    setApps(next);
    await persistMeta(next);
  };

  const handleRemoveCustom = async (app: LauncherApp) => {
    const next = apps.filter((a) => a.path !== app.path);
    setApps(next);
    await persistMeta(next);
  };

  const handleAddApp = async () => {
    const picked = await invoke<string | null>('pick_app_bundle');
    if (!picked) return;
    if (apps.some((a) => a.path === picked)) return;
    const base = picked.split('/').pop() ?? 'Custom App';
    const name = base.replace(/\.app$/i, '');
    const added: LauncherApp = {
      name,
      path: picked,
      category: 'Custom',
      description: 'Added via MU Launcher.',
      pinned: false,
      custom: true,
      mcpPort: null,
      running: false,
      mcpOnline: false,
    };
    const next = [...apps, added].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name)
    );
    setApps(next);
    await persistMeta(next);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps.filter((a) => {
      if (tab === 'pinned' && !a.pinned) return false;
      if (tab === 'running' && !a.running) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q)
      );
    });
  }, [apps, search, tab]);

  return (
    <div className="launcher-shell">
      <header className="topbar">
        <div className="brand-wrap">
          <div className="brand-icon">
            <img src={launcherIcon} alt="MU Launcher" className="brand-icon-img" />
          </div>
          <div>
            <div className="brand-title">MU Launcher</div>
            <div className="brand-sub">Game Development Apps & Tools</div>
          </div>
        </div>

        <div className="topbar-actions">
          <button className="btn btn-primary" onClick={() => void handleAddApp()}>
            <Plus size={14} />
            Add App
          </button>
        </div>
      </header>

      <div className="controls-bar">
        <div className="search-box">
          <Search size={14} color="#8b93a7" />
          <input
            type="text"
            placeholder="Search apps, tools, categories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="tabs">
          <button className={`tab ${tab === 'all' ? 'active' : ''}`} onClick={() => setTab('all')}>
            All ({apps.length})
          </button>
          <button
            className={`tab ${tab === 'pinned' ? 'active' : ''}`}
            onClick={() => setTab('pinned')}
          >
            Pinned ({apps.filter((a) => a.pinned).length})
          </button>
          <button
            className={`tab ${tab === 'running' ? 'active' : ''}`}
            onClick={() => setTab('running')}
          >
            Running ({apps.filter((a) => a.running).length})
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">Scanning apps in {hubRoot}...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          No matching apps found. Drop a <code>.app</code> folder into <strong>MU Launcher</strong>{' '}
          or click <strong>+ Add App</strong>.
        </div>
      ) : (
        <main className="grid">
          {filtered.map((app) => (
            <article key={app.path} className="card">
              <div className="card-head">
                <div className="card-title-row">
                  <div
                    className="app-avatar"
                    style={app.iconDataUrl ? undefined : { background: avatarGradient(app.name) }}
                  >
                    {app.iconDataUrl ? (
                      <img src={app.iconDataUrl} alt={app.name} className="app-avatar-img" />
                    ) : (
                      app.name.slice(0, 2).toUpperCase()
                    )}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="card-title">{app.name}</div>
                    <div className="card-cat">{app.category}</div>
                  </div>
                </div>
                <button
                  className={`pin-btn ${app.pinned ? 'pinned' : ''}`}
                  onClick={() => void handleTogglePin(app)}
                  title={app.pinned ? 'Unpin' : 'Pin to top'}
                >
                  <Star size={16} fill={app.pinned ? 'currentColor' : 'none'} />
                </button>
              </div>

              <div className="card-desc">{app.description}</div>

              {app.running && (
                <div className="status-row">
                  <span className="pill online">
                    <span className="dot" />
                    Running
                  </span>
                </div>
              )}

              <div className="card-actions">
                <button
                  className="btn btn-primary launch-btn"
                  onClick={() => void handleLaunch(app)}
                >
                  <Play size={13} />
                  {app.running ? 'Focus' : 'Launch'}
                </button>
                {app.running && (
                  <button
                    className="btn btn-danger btn-icon"
                    onClick={() => void handleQuit(app)}
                    title="Quit app"
                  >
                    <Square size={13} />
                  </button>
                )}
                <button
                  className="btn btn-icon"
                  onClick={() => void handleReveal(app)}
                  title="Reveal in Finder"
                >
                  <FolderOpen size={14} />
                </button>
                {app.custom && (
                  <button
                    className="btn btn-danger btn-icon"
                    onClick={() => void handleRemoveCustom(app)}
                    title="Remove from launcher"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </main>
      )}
    </div>
  );
}
