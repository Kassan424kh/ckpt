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

function Modal({ title, children, actions, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`
    <div class="modal-bg" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal" role="dialog" aria-modal="true">
        <h2>${title}</h2>
        ${children}
        <div class="actions">${actions}</div>
      </div>
    </div>
  `;
}

// ---------- header ----------

function Header({ branch, hasUndo, live, onRefresh, onPrune, onClean, onUndo }) {
  return html`
    <header>
      <span class="glyph">✦</span>
      <span class="title">ckpt</span>
      <span class="branch">${branch ? `${branch}` : ''}</span>
      <span class="spacer"></span>
      <span class=${classes('live', live)}>${live === 'active' ? 'live' : live === 'offline' ? 'offline' : 'idle'}</span>
      <button onClick=${onRefresh} title="Refresh now">↻ Refresh</button>
      <button onClick=${onPrune}>Prune…</button>
      <button onClick=${onUndo} disabled=${!hasUndo} title="Roll back the last restore">↶ Undo</button>
      <button class="danger" onClick=${onClean}>Clean</button>
    </header>
  `;
}

// ---------- projects column ----------

function ProjectList({ projects, selectedId, onSelect }) {
  if (!projects.length) {
    return html`<div class="empty">no projects yet — run Claude in a git repo</div>`;
  }
  return html`
    <div>
      ${projects.map(p => html`
        <div key=${p.id}
             class=${classes('project', selectedId === p.id && 'selected', !p.exists && 'missing')}
             onClick=${() => p.exists && onSelect(p.id)}
             title=${p.exists ? p.path : 'directory missing'}>
          <div class="name">${p.name || p.path.split('/').pop()}</div>
          <div class="path">${p.path}</div>
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

function CheckpointRow({ ckpt, selected, isNew, onSelect, onRestore, onDelete }) {
  return html`
    <div class=${classes('checkpoint', selected && 'selected', isNew && 'new')}
         onClick=${onSelect}>
      <div class="row1">
        <span class="when">${ckpt.when}</span>
        <span class="id">${ckpt.id}</span>
      </div>
      <div class="msg">${ckpt.message}</div>
      <${StatsRow} stats=${ckpt.stats} />
      <div class="actions">
        <button class="primary" onClick=${(e) => { e.stopPropagation(); onRestore(); }}>Restore</button>
        <button class="danger"  onClick=${(e) => { e.stopPropagation(); onDelete();  }}>Delete</button>
      </div>
    </div>
  `;
}

function CheckpointList({ checkpoints, selectedId, newIds, onSelect, onRestore, onDelete }) {
  if (!checkpoints.length) {
    return html`<div class="empty">no checkpoints yet — the Stop hook creates one after each turn</div>`;
  }
  return html`
    <div>
      ${checkpoints.map(c => html`
        <${CheckpointRow}
          key=${c.id}
          ckpt=${c}
          selected=${selectedId === c.id}
          isNew=${newIds.has(c.id)}
          onSelect=${() => onSelect(c.id)}
          onRestore=${() => onRestore(c)}
          onDelete=${() => onDelete(c)}
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
            : files.map(f => {
                const s = (f.status || '?')[0];
                return html`
                  <div key=${f.path}
                       class=${classes('file', selectedFile === f.path && 'selected')}
                       onClick=${() => onSelect(f.path)}>
                    <span class=${`status ${s}`}>${s}</span>
                    <span class="path" title=${f.path}>${f.path}</span>
                    <button class="action"
                            title="Restore just this file"
                            onClick=${(e) => { e.stopPropagation(); onRestoreFile(f.path); }}>⤴</button>
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
    const r = await api.post(`${apiBase(selectedProject)}/checkpoints/${encodeURIComponent(c.id)}/restore`);
    if (r?.ok) {
      toast(`restored to ${c.id}; deleted ${r.deleted} later`, 'ok');
      refreshCkpts(true);
    } else {
      toast(r?.error || 'restore failed', 'err');
    }
  }, [selectedProject, refreshCkpts]);

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

  const doUndo = useCallback(async () => {
    setModal(null);
    const r = await api.post(`${apiBase(selectedProject)}/undo`);
    if (r?.ok) { toast('reverted to pre-restore state', 'ok'); refreshCkpts(true); }
    else toast(r?.error || 'undo failed', 'err');
  }, [selectedProject, refreshCkpts]);

  const doClean = useCallback(async () => {
    setModal(null);
    const r = await api.post(`${apiBase(selectedProject)}/clean`);
    if (r?.ok) {
      toast(`deleted ${r.deleted} checkpoint(s)`, 'ok');
      setSelectedCkpt(null); setFiles([]); setSelectedFile(null); setDiff(null); setPrompt(null);
      refreshCkpts(true);
    } else {
      toast(r?.error || 'clean failed', 'err');
    }
  }, [selectedProject, refreshCkpts]);

  const doPrune = useCallback(async (n) => {
    setModal(null);
    const r = await api.post(`${apiBase(selectedProject)}/prune`, { n });
    if (r?.ok) { toast(`pruned ${r.deleted}; kept newest ${n}`, 'ok'); refreshCkpts(true); }
    else toast(r?.error || 'prune failed', 'err');
  }, [selectedProject, refreshCkpts]);

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
      <p class="muted">This will reset your working tree and index to this checkpoint, and
        <strong>delete every checkpoint created after it</strong>. A safety snapshot is saved so you can Undo.</p>
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

  // ---------- render ----------

  const selCkpt = checkpoints.find(c => c.id === selectedCkpt);

  return html`
    <div class="app">
      <${Header}
        branch=${status.branch}
        hasUndo=${status.has_undo}
        live=${liveState}
        onRefresh=${() => { refreshCkpts(true); refreshProjects(); }}
        onPrune=${openPrune}
        onClean=${openClean}
        onUndo=${openUndo}
      />
      <div class="main">
        <div class="col">
          <div class="col-header">Projects <span class="count">(${projects.filter(p => p.exists).length})</span></div>
          <div class="col-body">
            <${ProjectList} projects=${projects} selectedId=${selectedProject} onSelect=${setSelectedProject}/>
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
    </div>
  `;
}

render(html`<${App}/>`, document.getElementById('app'));
