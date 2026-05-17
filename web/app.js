// ckpt — Preact + htm UI, no build step.
// Important: hooks must come from the SAME Preact module that renders. Importing
// both `html`/`render` AND the hooks from `htm/preact/standalone` keeps a single
// Preact instance — otherwise `useState` fails with `undefined.__H`.
import {
  html, render,
  useState, useEffect, useCallback, useRef,
} from 'https://esm.sh/htm@3.1.1/preact/standalone';
import hljs from 'https://esm.sh/highlight.js@11.9.0';

// ---------- syntax highlighting ----------

const EXT_TO_LANG = {
  swift: 'swift',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', pyw: 'python',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',
  m: 'objectivec', mm: 'objectivec',
  metal: 'cpp',
  json: 'json',
  yaml: 'yaml', yml: 'yaml',
  toml: 'ini',
  ini: 'ini', conf: 'ini', cfg: 'ini',
  xml: 'xml', html: 'xml', htm: 'xml', svg: 'xml', plist: 'xml',
  css: 'css', scss: 'scss', sass: 'scss',
  md: 'markdown', markdown: 'markdown',
  sql: 'sql',
  dockerfile: 'dockerfile',
};

function getLanguage(path) {
  if (!path) return null;
  const base = path.split('/').pop() || '';
  if (base.toLowerCase() === 'dockerfile') return 'dockerfile';
  const ext = (base.split('.').pop() || '').toLowerCase();
  const lang = EXT_TO_LANG[ext] || null;
  if (lang && hljs.getLanguage(lang)) return lang;
  return null;
}

function highlightCode(code, lang) {
  if (!lang || !code) return null;
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch (e) {
    return null;
  }
}

// ---------- API client ----------

const api = {
  get:  (path) => fetch(path).then(r => r.headers.get('Content-Type')?.includes('json') ? r.json() : r.text()),
  post: (path, body) => fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  }).then(r => r.json()),
};

const apiBase = (pid) => `/api/projects/${encodeURIComponent(pid)}`;

// ---------- generic helpers ----------

function classes(...xs) { return xs.filter(Boolean).join(' '); }

// ---------- toasts (module-level for simplicity) ----------

let _toastSink = null;
function toast(message, kind = 'ok') {
  if (_toastSink) _toastSink(message, kind);
}

function ToastWrap() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    _toastSink = (message, kind) => {
      const id = Math.random().toString(36).slice(2);
      setToasts(t => [...t, { id, message, kind }]);
      setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4100);
    };
    return () => { _toastSink = null; };
  }, []);
  return html`
    <div class="toast-wrap">
      ${toasts.map(t => html`<div key=${t.id} class=${classes('toast', t.kind)}>${t.message}</div>`)}
    </div>
  `;
}

// ---------- modal ----------

function Modal({ title, body, children, actions, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`
    <div class="modal-bg" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal" role="dialog" aria-modal="true">
        <h2>${title}</h2>
        ${body}
        ${children}
        <div class="actions">${actions}</div>
      </div>
    </div>
  `;
}

// ---------- header ----------

function Header({ branch, live, onRefresh, onSettings }) {
  return html`
    <header>
      <span class="glyph"><span class="icon lg">auto_awesome</span></span>
      <span class="title">ckpt</span>
      <span class="branch">${branch ? `${branch}` : ''}</span>
      <span class="spacer"></span>
      <span class=${classes('live', live)}>${live === 'active' ? 'live' : live === 'offline' ? 'offline' : 'idle'}</span>
      <button onClick=${onRefresh} title="Refresh now"><span class="icon">refresh</span>Refresh</button>
      <button onClick=${onSettings} title="Settings (prune / undo / clean live here)"><span class="icon">settings</span>Settings</button>
    </header>
  `;
}

// ---------- settings ----------

const SETTINGS_KEY = 'ckpt.settings';
function loadSettings() {
  const defaults = { deleteLater: false, autoUpdate: false };
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...defaults, ...s };
  } catch { return defaults; }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
}

function SettingsModal({ settings, updateSettings, hasUndo, onClose, onPrune, onUndo, onClean }) {
  return html`
    <${Modal}
      title="Settings"
      onClose=${onClose}
      actions=${html`<button class="primary" onClick=${onClose}>Close</button>`}>
      <div class="settings-section">
        <div class="settings-section-title">Restore behavior</div>
        <label class="settings-toggle">
          <input type="checkbox"
                 checked=${settings.deleteLater}
                 onChange=${(e) => updateSettings({ deleteLater: e.currentTarget.checked })}/>
          <span>Delete later checkpoints when restoring</span>
        </label>
        <p class="settings-help warn">
          When restoring to an older checkpoint, also remove every checkpoint
          created after it. Off by default — keep this off to preserve a
          timeline you can navigate forward through.
        </p>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">Updates</div>
        <label class="settings-toggle">
          <input type="checkbox"
                 checked=${settings.autoUpdate}
                 onChange=${(e) => updateSettings({ autoUpdate: e.currentTarget.checked })}/>
          <span>Auto-update when a new version is available</span>
        </label>
        <p class="settings-help">
          When enabled, the latest commit on <code>main</code> is downloaded
          and applied as soon as the update check detects it (every 30 min,
          plus once on load). The page reloads automatically after each
          update. Each SHA is attempted only once per session.
        </p>
      </div>
      <div class="settings-section">
        <div class="settings-section-title">Maintenance · all projects</div>
        <div class="settings-actions">
          <button onClick=${onPrune}><span class="icon">filter_list</span>Prune all…</button>
          <button onClick=${onUndo} disabled=${!hasUndo} title="Roll back the last restore in every project"><span class="icon">undo</span>Undo all</button>
          <button class="danger solid" onClick=${onClean}><span class="icon">delete_sweep</span>Clean all</button>
        </div>
        <p class="settings-help warn settings-help-below">
          <span>These actions fan out across <strong>every</strong> registered project.
            Use the per-project <span class="icon sm">more_vert</span> menu to scope
            the same actions to a single project.</span>
        </p>
      </div>
    <//>
  `;
}

// ---------- projects column ----------

function ProjectMenu({ onClose, onPrune, onUndo, onClean }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onDown = (e) => {
      if (e.target.closest('.kebab-menu') || e.target.closest('.kebab')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  return html`
    <div class="kebab-menu" onClick=${(e) => e.stopPropagation()}>
      <button class="kebab-menu-item" onClick=${onPrune}><span class="icon sm">filter_list</span>Prune…</button>
      <button class="kebab-menu-item" onClick=${onUndo}><span class="icon sm">undo</span>Undo</button>
      <button class="kebab-menu-item danger" onClick=${onClean}><span class="icon sm">delete_sweep</span>Clean all</button>
    </div>
  `;
}

function ProjectList({
  projects, selectedId, openMenuId, onSelect,
  onOpenMenu, onCloseMenu,
  onPruneProject, onUndoProject, onCleanProject,
}) {
  if (!projects.length) {
    return html`<div class="empty">no projects yet — run Claude in a git repo</div>`;
  }
  return html`
    <div>
      ${projects.map((p, i) => html`
        <div key=${p.id}
             class=${classes('project', selectedId === p.id && 'selected', !p.exists && 'missing')}
             onClick=${() => p.exists && onSelect(p.id)}
             title=${p.exists ? p.path : 'directory missing'}>
          ${p.exists ? html`
            <button class="kebab"
                    title="Project actions"
                    onClick=${(e) => { e.stopPropagation(); onOpenMenu(openMenuId === p.id ? null : p.id); }}>
              <span class="icon sm">more_vert</span>
            </button>
          ` : null}
          <div class="name"><span class="list-index">#${i + 1}</span>${p.name || p.path.split('/').pop()}</div>
          <div class="path">${p.path}</div>
          ${openMenuId === p.id ? html`
            <${ProjectMenu}
              onClose=${() => onCloseMenu()}
              onPrune=${() => { onCloseMenu(); onPruneProject(p); }}
              onUndo=${() => { onCloseMenu(); onUndoProject(p); }}
              onClean=${() => { onCloseMenu(); onCleanProject(p); }}
            />
          ` : null}
        </div>
      `)}
    </div>
  `;
}

// ---------- checkpoint row ----------

function StatsRow({ stats }) {
  if (!stats) return null;
  const { files, insertions, deletions } = stats;
  if (!files && !insertions && !deletions) return null;
  const parts = [];
  if (insertions) parts.push(html`<span class="ins">+${insertions}</span>`);
  if (deletions)  parts.push(html`<span class="del">−${deletions}</span>`);
  if (files)      parts.push(html`<span class="files">${files} file${files === 1 ? '' : 's'}</span>`);
  const withSeps = [];
  parts.forEach((p, i) => {
    if (i > 0) withSeps.push(html`<span class="sep">·</span>`);
    withSeps.push(p);
  });
  return html`<div class="stats">${withSeps}</div>`;
}

function CheckpointRow({ ckpt, index, total, selected, isNew, onSelect, onRestore, onDelete, onPruneHere }) {
  // The last visible row is the oldest; pruning there would keep everything → disable.
  const isOldest = index === total;
  return html`
    <div class=${classes('checkpoint', selected && 'selected', isNew && 'new')}
         onClick=${onSelect}>
      <div class="row1">
        <span class="list-index">#${index}</span>
        <span class="when">${ckpt.when}</span>
        <span class="id">${ckpt.id}</span>
      </div>
      <div class="msg">${ckpt.message}</div>
      <${StatsRow} stats=${ckpt.stats} />
      <div class="actions">
        <button class="prune-here"
                disabled=${isOldest}
                title=${isOldest ? 'No older checkpoints' : `Delete every checkpoint older than this one — keeps the ${index} newest`}
                onClick=${(e) => { e.stopPropagation(); onPruneHere(); }}>
          <span class="icon sm">filter_list</span>Prune here
        </button>
        <span class="action-spacer"></span>
        <button class="danger"  onClick=${(e) => { e.stopPropagation(); onDelete();  }}>Delete</button>
        <button class="primary" onClick=${(e) => { e.stopPropagation(); onRestore(); }}>Restore</button>
      </div>
    </div>
  `;
}

function CheckpointList({ checkpoints, selectedId, newIds, onSelect, onRestore, onDelete, onPruneHere }) {
  if (!checkpoints.length) {
    return html`<div class="empty">no checkpoints yet — the Stop hook creates one after each turn</div>`;
  }
  return html`
    <div>
      ${checkpoints.map((c, i) => html`
        <${CheckpointRow}
          key=${c.id}
          ckpt=${c}
          index=${i + 1}
          total=${checkpoints.length}
          selected=${selectedId === c.id}
          isNew=${newIds.has(c.id)}
          onSelect=${() => onSelect(c.id)}
          onRestore=${() => onRestore(c)}
          onDelete=${() => onDelete(c)}
          onPruneHere=${() => onPruneHere(c, i + 1)}
        />
      `)}
    </div>
  `;
}

// ---------- prompt pane ----------

function PromptPane({ prompt, ckpt }) {
  const copy = useCallback(() => {
    if (!prompt) return;
    const ok = () => toast('prompt copied', 'ok');
    const err = () => toast('copy failed', 'err');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(prompt).then(ok).catch(err);
    } else {
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { err(); }
      document.body.removeChild(ta);
    }
  }, [prompt]);

  if (!prompt) return html`<div class="prompt-pane"></div>`;
  return html`
    <div class="prompt-pane active">
      <div class="prompt-header">
        <span class="prompt-label">Prompt</span>
        <span class="prompt-meta">${ckpt ? `${ckpt.when} · ${ckpt.id}` : ''}</span>
        <span class="prompt-spacer"></span>
        <button class="prompt-copy" onClick=${copy} title="Copy full prompt">Copy</button>
      </div>
      <div class="prompt-text">${prompt}</div>
    </div>
  `;
}

// ---------- files column ----------

function FilesList({ files, selectedFile, ckptId, ckpt, onSelect, onRestoreFile }) {
  const stats = ckpt?.stats;
  const headerStats = stats && (stats.insertions || stats.deletions) ? html`
    <span class="header-stats">
      ${stats.insertions ? html`<span class="ins">+${stats.insertions}</span>` : null}
      ${stats.deletions  ? html`<span class="del">−${stats.deletions}</span>` : null}
    </span>
  ` : null;

  return html`
    <div class="col">
      <div class="col-header">
        <span>Files ${files.length ? html`<span class="count">(${files.length})</span>` : null}</span>
        ${headerStats}
      </div>
      <div class="col-body">
        ${!ckptId
          ? html`<div class="empty">select a checkpoint</div>`
          : !files.length
            ? html`<div class="empty">no files changed in this checkpoint</div>`
            : files.map((f, i) => {
                const s = (f.status || '?')[0];
                return html`
                  <div key=${f.path}
                       class=${classes('file', selectedFile === f.path && 'selected')}
                       onClick=${() => onSelect(f.path)}>
                    <span class="list-index">#${i + 1}</span>
                    <span class=${`status ${s}`}>${s}</span>
                    <span class="path" title=${f.path}>${f.path}</span>
                    <button class="action"
                            title="Restore just this file"
                            onClick=${(e) => { e.stopPropagation(); onRestoreFile(f.path); }}><span class="icon sm">restore</span></button>
                  </div>
                `;
              })
        }
      </div>
    </div>
  `;
}

// ---------- diff viewer ----------

function parseDiff(text, lang) {
  const lines = text.split('\n');
  let ins = 0, del = 0;
  let inHunk = false, oldLine = 0, newLine = 0;
  const rendered = lines.map((line, i) => {
    // Skip redundant diff headers — the file path is already in the toolbar.
    if (/^(diff --git |index |--- |\+\+\+ )/.test(line)) return null;

    let cls = 'meta', gOld = '', gNew = '';
    let prefix = '', code = line, kind = 'meta';

    if (/^(new file|deleted file|rename |similarity |Binary )/.test(line)) {
      cls = 'meta file-header'; inHunk = false; kind = 'meta';
    } else if (line.startsWith('@@')) {
      cls = 'hunk'; inHunk = true; kind = 'hunk';
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) { oldLine = parseInt(m[1], 10); newLine = parseInt(m[2], 10); }
    } else if (inHunk && line.startsWith('+')) {
      cls = 'add'; ins++; gNew = newLine++;
      prefix = '+'; code = line.slice(1); kind = 'add';
    } else if (inHunk && line.startsWith('-')) {
      cls = 'del'; del++; gOld = oldLine++;
      prefix = '-'; code = line.slice(1); kind = 'del';
    } else if (inHunk) {
      gOld = oldLine++; gNew = newLine++;
      prefix = line[0] || ' '; code = line.slice(1); kind = 'context';
    }

    // Highlight only code lines (add/del/context). Meta/hunk lines stay literal.
    const highlighted = (lang && (kind === 'add' || kind === 'del' || kind === 'context'))
      ? highlightCode(code, lang) : null;

    return { i, cls, gOld, gNew, prefix, code, highlighted, raw: line, kind };
  }).filter(Boolean);
  return { lines: rendered, ins, del };
}

function DiffViewer({ path, text }) {
  if (!path) return html`
    <div class="col">
      <div class="col-body"><div class="empty">select a file to see the diff</div></div>
    </div>
  `;
  if (text == null) return html`
    <div class="col">
      <div class="diff-toolbar"><span class="path">${path}</span></div>
      <div class="col-body"><div class="empty">loading diff…</div></div>
    </div>
  `;
  if (!text || text.trim() === '') return html`
    <div class="col">
      <div class="diff-toolbar"><span class="path">${path}</span></div>
      <div class="col-body"><div class="empty">(no diff — file may be unchanged or binary)</div></div>
    </div>
  `;
  const lang = getLanguage(path);
  const { lines, ins, del } = parseDiff(text, lang);
  return html`
    <div class="col">
      <div class="diff-toolbar">
        <span class="path">${path}</span>
        <span class="stats">
          <span class="ins">+${ins}</span> <span class="del">−${del}</span>
        </span>
      </div>
      <div class="col-body">
        <div class="diff">
          ${lines.map(l => {
            if (l.kind === 'meta' || l.kind === 'hunk') {
              return html`
                <div key=${l.i} class=${classes('diff-line', l.cls)}>
                  <span class="gutter"></span>
                  <span class="gutter"></span>
                  <span class="content"><span class="code">${l.raw || ' '}</span></span>
                </div>
              `;
            }
            return html`
              <div key=${l.i} class=${classes('diff-line', l.cls)}>
                <span class="gutter">${l.gOld}</span>
                <span class="gutter">${l.gNew}</span>
                <span class="content"><span class="prefix">${l.prefix}</span>${
                  l.highlighted
                    ? html`<span class="code hljs" dangerouslySetInnerHTML=${{ __html: l.highlighted || ' ' }}></span>`
                    : html`<span class="code">${l.code || ' '}</span>`
                }</span>
              </div>
            `;
          })}
        </div>
      </div>
    </div>
  `;
}

// ---------- update banner ----------

const DISMISSED_KEY = 'ckpt.dismissedUpdate';

function UpdateBanner({ info, busy, onUpdate, onDismiss }) {
  if (!info || !info.ok || !info.latest || info.behind < 1) return null;
  const dismissed = localStorage.getItem(DISMISSED_KEY);
  if (dismissed && dismissed === info.latest) return null;

  const commits = (info.commits || []).slice(0, 8);
  return html`
    <div class="update-banner">
      <div class="update-banner-row">
        <span class="icon">system_update</span>
        <span class="update-banner-title">Update available</span>
        <span class="update-banner-meta">
          ${info.behind} commit${info.behind === 1 ? '' : 's'} ahead
          ${info.current ? html` · current ${info.current.slice(0, 7)}` : null}
          ${info.latest  ? html` → latest ${info.latest.slice(0, 7)}` : null}
        </span>
        <span class="spacer"></span>
        <button onClick=${onDismiss} disabled=${busy}>Dismiss</button>
        <button class="primary" onClick=${onUpdate} disabled=${busy}>
          ${busy ? html`<span class="icon">progress_activity</span>Updating…` : html`<span class="icon">download</span>Update now`}
        </button>
      </div>
      ${commits.length ? html`
        <div class="update-banner-changes">
          <div class="update-banner-changes-label">Recent changes</div>
          <ul class="update-banner-changelist">
            ${commits.map(c => html`
              <li key=${c.sha}>
                <span class="change-sha">${c.sha}</span>
                <span class="change-subject">${c.subject || '(no message)'}</span>
              </li>
            `)}
          </ul>
        </div>
      ` : null}
    </div>
  `;
}

// ---------- main App ----------

function App() {
  // projects + status
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [status, setStatus] = useState({ branch: '', has_undo: false, count: 0 });
  const [liveState, setLiveState] = useState('active'); // active | offline | idle

  // checkpoints
  const [checkpoints, setCheckpoints] = useState([]);
  const [selectedCkpt, setSelectedCkpt] = useState(null);
  const [newIds, setNewIds] = useState(new Set());

  // prompt
  const [prompt, setPrompt] = useState(null);

  // files / diff
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [diff, setDiff] = useState(null);

  // modal
  const [modal, setModal] = useState(null);

  // settings (persisted to localStorage)
  const [settings, setSettingsState] = useState(loadSettings);
  const [showSettings, setShowSettings] = useState(false);

  // self-update
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateBusy, setUpdateBusy] = useState(false);

  // project-row kebab menu (one open at a time)
  const [openMenuId, setOpenMenuId] = useState(null);
  const updateSettings = useCallback((patch) => {
    setSettingsState(prev => { const s = { ...prev, ...patch }; saveSettings(s); return s; });
  }, []);

  const lastIdsRef = useRef(new Set());

  // ---------- fetchers ----------

  const refreshProjects = useCallback(async () => {
    try {
      const list = await api.get('/api/projects');
      setProjects(Array.isArray(list) ? list : []);
      // Auto-select first existing project if none selected
      if (!selectedProject && Array.isArray(list)) {
        const first = list.find(p => p.exists);
        if (first) setSelectedProject(first.id);
      }
      setLiveState('active');
    } catch (e) {
      setLiveState('offline');
    }
  }, [selectedProject]);

  const refreshCkpts = useCallback(async (force = false) => {
    if (!selectedProject) return;
    try {
      const [list, st] = await Promise.all([
        api.get(`${apiBase(selectedProject)}/checkpoints`),
        api.get(`${apiBase(selectedProject)}/status`),
      ]);
      if (!Array.isArray(list)) return;
      const oldIds = lastIdsRef.current;
      const wasInitial = oldIds.size === 0;
      const fresh = new Set(list.filter(c => !wasInitial && !oldIds.has(c.id)).map(c => c.id));
      setCheckpoints(list);
      setStatus(st || { branch: '', has_undo: false, count: list.length });
      setNewIds(fresh);
      lastIdsRef.current = new Set(list.map(c => c.id));
      if (fresh.size && !force) toast(`+${fresh.size} new checkpoint${fresh.size > 1 ? 's' : ''}`, 'info');
      // Auto-clear new flag after pulse animation
      setTimeout(() => setNewIds(new Set()), 1700);
      // Drop selection if the selected checkpoint vanished
      if (selectedCkpt && !list.find(c => c.id === selectedCkpt)) {
        setSelectedCkpt(null);
        setFiles([]); setSelectedFile(null); setDiff(null); setPrompt(null);
      }
      setLiveState('active');
    } catch (e) {
      setLiveState('offline');
    }
  }, [selectedProject, selectedCkpt]);

  // ---------- effects ----------

  useEffect(() => { refreshProjects(); }, []);

  // Update check: once on mount, then every 30 minutes.
  useEffect(() => {
    const fetchUpdates = () => api.get('/api/updates').then(setUpdateInfo).catch(() => {});
    fetchUpdates();
    const t = setInterval(fetchUpdates, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const doUpdate = useCallback(async () => {
    setUpdateBusy(true);
    toast('downloading update…', 'info');
    const r = await api.post('/api/update').catch(e => ({ ok: false, error: String(e) }));
    if (!r?.ok) {
      setUpdateBusy(false);
      toast(`update failed: ${r?.error || 'unknown error'}`, 'err');
      return;
    }
    const tag = r.version ? r.version.slice(0, 7) : 'main';
    if (r.restarting) {
      toast(`updated to ${tag}; restarting server…`, 'ok');
      // Poll /api/version until the new server answers, then reload.
      let tries = 0;
      const max = 40;            // 40 * 500ms = 20s
      const check = async () => {
        if (tries++ >= max) {
          setUpdateBusy(false);
          toast('server didn\'t come back — reload manually', 'err');
          return;
        }
        try {
          const resp = await fetch('/api/version', { cache: 'no-store' });
          if (resp.ok) { window.location.reload(); return; }
        } catch {}
        setTimeout(check, 500);
      };
      setTimeout(check, 800);    // give the new process a head start
    } else {
      setUpdateBusy(false);
      toast(`updated to ${tag}; reloading…`, 'ok');
      setTimeout(() => window.location.reload(), 1200);
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    if (updateInfo?.latest) localStorage.setItem('ckpt.dismissedUpdate', updateInfo.latest);
    setUpdateInfo({ ...updateInfo, behind: 0 });  // hide locally
  }, [updateInfo]);

  // Auto-update: when the toggle is on and a new SHA appears, run doUpdate()
  // once per session per SHA. Re-tries on a different SHA, but never loops
  // on the same failed one.
  const autoTriedRef = useRef(null);
  useEffect(() => {
    if (!settings.autoUpdate) return;
    if (!updateInfo?.ok) return;
    if (!updateInfo.latest || (updateInfo.behind || 0) < 1) return;
    if (updateBusy) return;
    if (autoTriedRef.current === updateInfo.latest) return;
    const dismissed = localStorage.getItem('ckpt.dismissedUpdate');
    if (dismissed === updateInfo.latest) return;
    autoTriedRef.current = updateInfo.latest;
    toast('auto-update: new version detected', 'info');
    doUpdate();
  }, [settings.autoUpdate, updateInfo, updateBusy, doUpdate]);
  useEffect(() => {
    lastIdsRef.current = new Set();
    setCheckpoints([]); setSelectedCkpt(null);
    setFiles([]); setSelectedFile(null); setDiff(null); setPrompt(null);
    refreshCkpts(true);
  }, [selectedProject]);

  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) { refreshCkpts(false); refreshProjects(); }
    }, 2500);
    return () => clearInterval(t);
  }, [refreshCkpts, refreshProjects]);

  useEffect(() => {
    const onVis = () => { if (!document.hidden) { refreshCkpts(true); refreshProjects(); } };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [refreshCkpts, refreshProjects]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if ((e.key === 'r' || e.key === 'R') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); refreshCkpts(true); refreshProjects();
      }
      if (!checkpoints.length) return;
      const i = checkpoints.findIndex(c => c.id === selectedCkpt);
      if (e.key === 'j' || e.key === 'ArrowDown') {
        const next = checkpoints[Math.min(i + 1, checkpoints.length - 1)] || checkpoints[0];
        if (next) selectCheckpoint(next.id);
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        const prev = checkpoints[Math.max(i - 1, 0)];
        if (prev) selectCheckpoint(prev.id);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [checkpoints, selectedCkpt]);

  // ---------- checkpoint selection ----------

  const selectCheckpoint = useCallback(async (id) => {
    setSelectedCkpt(id);
    setSelectedFile(null);
    setFiles([]); setDiff(null); setPrompt(null);

    const base = apiBase(selectedProject);
    const [promptResp, filesResp] = await Promise.all([
      api.get(`${base}/checkpoints/${encodeURIComponent(id)}/prompt`).catch(() => ({ prompt: null })),
      api.get(`${base}/checkpoints/${encodeURIComponent(id)}/files`).catch(() => []),
    ]);
    setPrompt(promptResp?.prompt || null);
    if (Array.isArray(filesResp)) {
      setFiles(filesResp);
      if (filesResp.length) selectFile(id, filesResp[0].path);
    }
  }, [selectedProject]);

  const selectFile = useCallback(async (ckptId, path) => {
    setSelectedFile(path);
    setDiff(null);
    try {
      const text = await api.get(`${apiBase(selectedProject)}/checkpoints/${encodeURIComponent(ckptId)}/file-diff?path=${encodeURIComponent(path)}`);
      setDiff(typeof text === 'string' ? text : '');
    } catch (e) {
      setDiff('');
    }
  }, [selectedProject]);

  // ---------- actions ----------

  const doRestore = useCallback(async (c) => {
    setModal(null);
    toast(`restoring to ${c.id}…`, 'info');
    const r = await api.post(
      `${apiBase(selectedProject)}/checkpoints/${encodeURIComponent(c.id)}/restore`,
      { delete_later: !!settings.deleteLater },
    );
    if (r?.ok) {
      if (settings.deleteLater && r.deleted) {
        toast(`restored to ${c.id}; deleted ${r.deleted} later`, 'ok');
      } else {
        toast(`restored to ${c.id}`, 'ok');
      }
      refreshCkpts(true);
    } else {
      toast(r?.error || 'restore failed', 'err');
    }
  }, [selectedProject, settings.deleteLater, refreshCkpts]);

  const doDelete = useCallback(async (c) => {
    setModal(null);
    const r = await api.post(`${apiBase(selectedProject)}/checkpoints/${encodeURIComponent(c.id)}/delete`);
    if (r?.ok) {
      toast(`deleted ${c.id}`, 'ok');
      if (selectedCkpt === c.id) {
        setSelectedCkpt(null); setFiles([]); setSelectedFile(null); setDiff(null); setPrompt(null);
      }
      refreshCkpts(true);
    } else {
      toast(r?.error || 'delete failed', 'err');
    }
  }, [selectedProject, selectedCkpt, refreshCkpts]);

  const doRestoreFile = useCallback(async (path) => {
    const r = await api.post(`${apiBase(selectedProject)}/checkpoints/${encodeURIComponent(selectedCkpt)}/restore-file`, { path });
    if (r?.ok) toast(`restored: ${path}`, 'ok');
    else toast(r?.error || 'restore failed', 'err');
  }, [selectedProject, selectedCkpt]);

  const doUndo = useCallback(async (projectId) => {
    setModal(null);
    const pid = projectId || selectedProject;
    if (!pid) return;
    const r = await api.post(`${apiBase(pid)}/undo`);
    if (r?.ok) { toast('reverted to pre-restore state', 'ok'); refreshCkpts(true); }
    else toast(r?.error || 'undo failed', 'err');
  }, [selectedProject, refreshCkpts]);

  const doClean = useCallback(async (projectId) => {
    setModal(null);
    const pid = projectId || selectedProject;
    if (!pid) return;
    const r = await api.post(`${apiBase(pid)}/clean`);
    if (r?.ok) {
      toast(`deleted ${r.deleted} checkpoint(s)`, 'ok');
      if (pid === selectedProject) {
        setSelectedCkpt(null); setFiles([]); setSelectedFile(null); setDiff(null); setPrompt(null);
      }
      refreshCkpts(true);
    } else {
      toast(r?.error || 'clean failed', 'err');
    }
  }, [selectedProject, refreshCkpts]);

  const doPrune = useCallback(async (n, projectId) => {
    setModal(null);
    const pid = projectId || selectedProject;
    if (!pid) return;
    const r = await api.post(`${apiBase(pid)}/prune`, { n });
    if (r?.ok) { toast(`pruned ${r.deleted}; kept newest ${n}`, 'ok'); refreshCkpts(true); }
    else toast(r?.error || 'prune failed', 'err');
  }, [selectedProject, refreshCkpts]);

  // --- global variants: fan out across every existing project ---
  const doGlobalPrune = useCallback(async (n) => {
    setModal(null);
    const visible = projects.filter(p => p.exists);
    if (!visible.length) { toast('no projects', 'info'); return; }
    toast(`pruning ${visible.length} project(s)…`, 'info');
    const results = await Promise.all(
      visible.map(p => api.post(`${apiBase(p.id)}/prune`, { n }).catch(() => ({ ok: false })))
    );
    const total = results.filter(r => r?.ok).reduce((s, r) => s + (r.deleted || 0), 0);
    toast(`pruned ${total} across ${visible.length} project(s); kept newest ${n} each`, 'ok');
    refreshCkpts(true); refreshProjects();
  }, [projects, refreshCkpts, refreshProjects]);

  const doGlobalClean = useCallback(async () => {
    setModal(null);
    const visible = projects.filter(p => p.exists);
    if (!visible.length) { toast('no projects', 'info'); return; }
    toast(`cleaning ${visible.length} project(s)…`, 'info');
    const results = await Promise.all(
      visible.map(p => api.post(`${apiBase(p.id)}/clean`).catch(() => ({ ok: false })))
    );
    const total = results.filter(r => r?.ok).reduce((s, r) => s + (r.deleted || 0), 0);
    toast(`deleted ${total} across ${visible.length} project(s)`, 'ok');
    setSelectedCkpt(null); setFiles([]); setSelectedFile(null); setDiff(null); setPrompt(null);
    refreshCkpts(true);
  }, [projects, refreshCkpts]);

  const doGlobalUndo = useCallback(async () => {
    setModal(null);
    const visible = projects.filter(p => p.exists);
    if (!visible.length) { toast('no projects', 'info'); return; }
    toast(`undoing in ${visible.length} project(s)…`, 'info');
    const results = await Promise.all(
      visible.map(p => api.post(`${apiBase(p.id)}/undo`).catch(() => ({ ok: false })))
    );
    const ok = results.filter(r => r?.ok).length;
    toast(ok ? `reverted in ${ok} project(s)` : 'no projects had a safety snapshot', ok ? 'ok' : 'info');
    refreshCkpts(true);
  }, [projects, refreshCkpts]);

  // ---------- modals ----------

  const openRestoreFile = (path) => setModal({
    title: 'Restore single file?',
    body: html`
      <p><code>${path}</code></p>
      <p class="muted">Replace your current copy of this file with the version from
        checkpoint <code>${selectedCkpt}</code>.</p>
      <p class="muted">Other files unchanged. No checkpoints are deleted.</p>
    `,
    actions: html`
      <button onClick=${() => setModal(null)}>Cancel</button>
      <button class="primary"
              onClick=${() => { setModal(null); doRestoreFile(path); }}>Restore file</button>
    `,
  });

  const openRestore = (c) => setModal({
    title: 'Restore to checkpoint',
    body: html`
      <p><code>${c.id}</code></p>
      <p><strong>${c.message}</strong></p>
      <p class="muted">Hard-resets your working tree and index to this checkpoint.
        A safety snapshot of your current state is saved so you can Undo.</p>
      <p class="muted">Later checkpoints are kept — you can restore forward
        at any time if you change your mind.</p>
    `,
    actions: html`
      <button onClick=${() => setModal(null)}>Cancel</button>
      <button class="primary" onClick=${() => doRestore(c)}>Restore</button>
    `,
  });

  const openDelete = (c) => setModal({
    title: 'Delete checkpoint',
    body: html`
      <p>Remove <code>${c.id}</code>?</p>
      <p class="muted">Working tree unchanged. The snapshot is gone for good.</p>
    `,
    actions: html`
      <button onClick=${() => setModal(null)}>Cancel</button>
      <button class="danger solid" onClick=${() => doDelete(c)}>Delete</button>
    `,
  });

  const openPrune = () => {
    let val = 20;
    setModal({
      title: 'Prune checkpoints',
      body: html`
        <p>Keep only the N most recent checkpoints.</p>
        <p>Keep: <input type="number" min="0" value=${val} onInput=${(e) => val = parseInt(e.currentTarget.value, 10)}/></p>
      `,
      actions: html`
        <button onClick=${() => setModal(null)}>Cancel</button>
        <button class="primary" onClick=${() => doPrune(val)}>Prune</button>
      `,
    });
  };

  const openClean = () => setModal({
    title: 'Delete all checkpoints?',
    body: html`
      <p>This removes <strong>every</strong> checkpoint plus the undo snapshot for this project.</p>
      <p class="muted">Working tree unchanged. Not reversible.</p>
    `,
    actions: html`
      <button onClick=${() => setModal(null)}>Cancel</button>
      <button class="danger solid" onClick=${() => doClean()}>Delete all</button>
    `,
  });

  const openUndo = () => setModal({
    title: 'Undo last restore',
    body: html`
      <p>Hard-reset your working tree and index to the pre-restore safety snapshot.</p>
      <p class="muted">Any changes made after the restore will be lost. Does not bring back deleted checkpoints.</p>
    `,
    actions: html`
      <button onClick=${() => setModal(null)}>Cancel</button>
      <button class="primary" onClick=${() => doUndo()}>Undo</button>
    `,
  });

  // ---------- per-project openers (targeted by kebab menu) ----------

  const openPruneProject = (project) => {
    let val = 20;
    setModal({
      title: html`Prune <code>${project.name}</code>`,
      body: html`
        <p>Keep only the N most recent checkpoints in this project.</p>
        <p>Keep: <input type="number" min="0" value=${val} onInput=${(e) => val = parseInt(e.currentTarget.value, 10)}/></p>
      `,
      actions: html`
        <button onClick=${() => setModal(null)}>Cancel</button>
        <button class="primary" onClick=${() => doPrune(val, project.id)}>Prune</button>
      `,
    });
  };

  const openUndoProject = (project) => setModal({
    title: html`Undo last restore in <code>${project.name}</code>`,
    body: html`
      <p>Hard-reset working tree and index of this project to its pre-restore safety snapshot.</p>
      <p class="muted">Any changes after the restore will be lost. Does nothing if no recent restore exists.</p>
    `,
    actions: html`
      <button onClick=${() => setModal(null)}>Cancel</button>
      <button class="primary" onClick=${() => doUndo(project.id)}>Undo</button>
    `,
  });

  const openPruneHere = (checkpoint, index) => {
    const total = checkpoints.length;
    const deleted = total - index;
    setModal({
      title: 'Prune older checkpoints',
      body: html`
        <p>Keep the <strong>${index}</strong> newest checkpoint${index === 1 ? '' : 's'},
          deleting <strong>${deleted}</strong> older one${deleted === 1 ? '' : 's'}.</p>
        <p class="muted">Cutoff at <code>${checkpoint.id}</code> — <em>${checkpoint.message || '(no message)'}</em></p>
        <p class="muted">Working tree unchanged. Not reversible.</p>
      `,
      actions: html`
        <button onClick=${() => setModal(null)}>Cancel</button>
        <button class="primary" onClick=${() => doPrune(index, selectedProject)}>Prune older</button>
      `,
    });
  };

  const openCleanProject = (project) => setModal({
    title: html`Delete all checkpoints in <code>${project.name}</code>?`,
    body: html`
      <p>Removes every checkpoint plus the undo safety snapshot for this project.</p>
      <p class="muted">Working tree unchanged. Not reversible.</p>
    `,
    actions: html`
      <button onClick=${() => setModal(null)}>Cancel</button>
      <button class="danger solid" onClick=${() => doClean(project.id)}>Delete all</button>
    `,
  });

  // ---------- global openers (used by the Settings modal) ----------

  const openGlobalPrune = () => {
    let val = 20;
    setModal({
      title: 'Prune all projects',
      body: html`
        <p>Keep only the N most recent checkpoints in <strong>every</strong> registered project.</p>
        <p>Keep: <input type="number" min="0" value=${val} onInput=${(e) => val = parseInt(e.currentTarget.value, 10)}/></p>
      `,
      actions: html`
        <button onClick=${() => setModal(null)}>Cancel</button>
        <button class="primary" onClick=${() => doGlobalPrune(val)}>Prune all projects</button>
      `,
    });
  };

  const openGlobalUndo = () => setModal({
    title: 'Undo last restore in all projects',
    body: html`
      <p>Hard-reset every project to its pre-restore safety snapshot.</p>
      <p class="muted">Projects without a recent restore are skipped. Any changes after each restore will be lost.</p>
    `,
    actions: html`
      <button onClick=${() => setModal(null)}>Cancel</button>
      <button class="primary" onClick=${() => doGlobalUndo()}>Undo everywhere</button>
    `,
  });

  const openGlobalClean = () => setModal({
    title: 'Delete all checkpoints in every project?',
    body: html`
      <p>Removes <strong>every</strong> checkpoint plus undo snapshots from <strong>every</strong> registered project.</p>
      <p class="muted">Working trees are unchanged. Not reversible.</p>
    `,
    actions: html`
      <button onClick=${() => setModal(null)}>Cancel</button>
      <button class="danger solid" onClick=${() => doGlobalClean()}>Delete all everywhere</button>
    `,
  });

  // ---------- render ----------

  const selCkpt = checkpoints.find(c => c.id === selectedCkpt);

  return html`
    <div class="app">
      <${Header}
        branch=${status.branch}
        live=${liveState}
        onRefresh=${() => { refreshCkpts(true); refreshProjects(); }}
        onSettings=${() => setShowSettings(true)}
      />
      <${UpdateBanner}
        info=${updateInfo}
        busy=${updateBusy}
        onUpdate=${doUpdate}
        onDismiss=${dismissUpdate}
      />
      <div class="main">
        <div class="col">
          <div class="col-header">Projects <span class="count">(${projects.filter(p => p.exists).length})</span></div>
          <div class="col-body">
            <${ProjectList}
              projects=${projects}
              selectedId=${selectedProject}
              openMenuId=${openMenuId}
              onSelect=${setSelectedProject}
              onOpenMenu=${setOpenMenuId}
              onCloseMenu=${() => setOpenMenuId(null)}
              onPruneProject=${openPruneProject}
              onUndoProject=${openUndoProject}
              onCleanProject=${openCleanProject}
            />
          </div>
        </div>
        <div class="col">
          <div class="col-header">Checkpoints <span class="count">(${checkpoints.length})</span></div>
          <div class="col-body">
            <${CheckpointList}
              checkpoints=${checkpoints}
              selectedId=${selectedCkpt}
              newIds=${newIds}
              onSelect=${selectCheckpoint}
              onRestore=${openRestore}
              onDelete=${openDelete}
              onPruneHere=${openPruneHere}
            />
          </div>
        </div>
        <div class="main-right">
          <${PromptPane} prompt=${prompt} ckpt=${selCkpt}/>
          <div class="main-right-bottom">
            <${FilesList}
              files=${files}
              selectedFile=${selectedFile}
              ckptId=${selectedCkpt}
              ckpt=${selCkpt}
              onSelect=${(p) => selectFile(selectedCkpt, p)}
              onRestoreFile=${openRestoreFile}
            />
            <${DiffViewer} path=${selectedFile} text=${diff}/>
          </div>
        </div>
      </div>
      <${ToastWrap}/>
      ${modal && html`<${Modal} ...${modal} onClose=${() => setModal(null)}/>`}
      ${showSettings && html`
        <${SettingsModal}
          settings=${settings}
          updateSettings=${updateSettings}
          hasUndo=${true}
          onClose=${() => setShowSettings(false)}
          onPrune=${() => { setShowSettings(false); openGlobalPrune(); }}
          onUndo=${() => { setShowSettings(false); openGlobalUndo(); }}
          onClean=${() => { setShowSettings(false); openGlobalClean(); }}
        />
      `}
    </div>
  `;
}

render(html`<${App}/>`, document.getElementById('app'));
