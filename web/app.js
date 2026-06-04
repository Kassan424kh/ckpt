// ckpt — Preact + htm UI, no build step.
// Important: hooks must come from the SAME Preact module that renders. Importing
// both `html`/`render` AND the hooks from `htm/preact/standalone` keeps a single
// Preact instance — otherwise `useState` fails with `undefined.__H`.
import {
  html, render,
  useState, useEffect, useCallback, useRef, useMemo,
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

// ---------- multi-select ----------
//
// Same model in every column: a Set of selected ids + an "anchor" (the
// last-clicked row, used as the pivot for shift-range selection). Plain
// click resets the set to {id} AND fires the column's navigation callback.
// Cmd/Ctrl click toggles `id` in/out of the set without navigating. Shift
// click selects the range `[anchor..id]` from the column's visible-rows
// array. Caller decides whether to fire navigation based on the modifier.

const EMPTY_SELECTION = { ids: new Set(), anchor: null };

function isMultiClick(e) {
  return !!(e && (e.shiftKey || e.metaKey || e.ctrlKey));
}

// Shift-click would otherwise paint a native text selection from the
// anchor row to the clicked row. preventDefault on the mousedown stops the
// browser from starting a selection; the click event still fires with
// shiftKey set so our range-select logic runs.
const suppressShiftSelect = (e) => { if (e.shiftKey) e.preventDefault(); };

function selectionFromClick(prev, id, orderedIds, e) {
  if (e && e.shiftKey && prev.anchor != null) {
    const a = orderedIds.indexOf(prev.anchor);
    const b = orderedIds.indexOf(id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      return { ids: new Set(orderedIds.slice(lo, hi + 1)), anchor: prev.anchor };
    }
  }
  if (e && (e.metaKey || e.ctrlKey)) {
    const ids = new Set(prev.ids);
    if (ids.has(id)) ids.delete(id); else ids.add(id);
    return { ids, anchor: id };
  }
  return { ids: new Set([id]), anchor: id };
}

// Wrap each match of `query` in `text` with a <mark> so the column rows can
// show *what* matched, not just that something did. Returns the text unchanged
// when the query is empty or the regex is invalid — callers can drop it in
// place of plain text without guarding.
function highlightText(text, query, regex) {
  if (!query || text == null) return text;
  const str = String(text);
  let re;
  try {
    re = regex
      ? new RegExp(query, 'g')
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  } catch {
    return str;
  }
  const parts = [];
  let last = 0, m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) parts.push(str.slice(last, m.index));
    parts.push(html`<mark>${m[0]}</mark>`);
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;   // guard against zero-width regex
  }
  if (!parts.length) return str;
  if (last < str.length) parts.push(str.slice(last));
  return parts;
}

// Curry a per-render highlighter so we don't thread `query`/`regex` through
// every child. When there's no active query, returns identity so React skips
// the work entirely.
function makeHighlighter(query, regex) {
  if (!query?.trim()) return (text) => text;
  return (text) => highlightText(text, query, regex);
}

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

function Header({ branch, live, search, onRefresh, onSettings }) {
  return html`
    <header>
      <span class="glyph"><span class="icon lg">auto_awesome</span></span>
      <span class="title">ckpt</span>
      <span class="branch">${branch ? `${branch}` : ''}</span>
      <span class="spacer"></span>
      ${search}
      <span class=${classes('live', live)}>${live === 'active' ? 'live' : live === 'offline' ? 'offline' : 'idle'}</span>
      <button onClick=${onRefresh} title="Refresh now"><span class="icon">refresh</span>Refresh</button>
      <button onClick=${onSettings} title="Settings (prune / undo / clean live here)"><span class="icon">settings</span>Settings</button>
    </header>
  `;
}

// ---------- global search ----------

const DEFAULT_SEARCH_OPTIONS = {
  scope: { projects: true, checkpoints: true, diffs: true },
  project_ids: [],   // empty = all visible projects
  since: '',
  until: '',
  mode: 'include',   // include | exclude
};

function SearchFilters({ options, updateOptions, projects, onReset }) {
  const scope = options.scope || {};
  const setScope = (key, val) => updateOptions({ scope: { ...scope, [key]: val } });
  const toggleProject = (pid) => {
    const cur = new Set(options.project_ids || []);
    if (cur.has(pid)) cur.delete(pid); else cur.add(pid);
    updateOptions({ project_ids: [...cur] });
  };
  const visible = projects.filter(p => p.exists);
  const allSelected = !(options.project_ids || []).length;
  return html`
    <div class="search-filters">
      <div class="search-filter-row">
        <div class="search-filter-label">Scope</div>
        <div class="search-filter-controls">
          ${[['projects', 'Projects'], ['checkpoints', 'Checkpoints'], ['diffs', 'Diffs']].map(([k, label]) => html`
            <label key=${k} class="search-chip">
              <input type="checkbox" checked=${scope[k] !== false}
                     onChange=${(e) => setScope(k, e.currentTarget.checked)}/>
              <span>${label}</span>
            </label>
          `)}
        </div>
      </div>
      <div class="search-filter-row">
        <div class="search-filter-label">Match</div>
        <div class="search-filter-controls">
          <label class="search-chip">
            <input type="radio" name="search-mode" checked=${options.mode !== 'exclude'}
                   onChange=${() => updateOptions({ mode: 'include' })}/>
            <span>Includes</span>
          </label>
          <label class="search-chip">
            <input type="radio" name="search-mode" checked=${options.mode === 'exclude'}
                   onChange=${() => updateOptions({ mode: 'exclude' })}/>
            <span>Excludes</span>
          </label>
        </div>
      </div>
      <div class="search-filter-row">
        <div class="search-filter-label">Duration</div>
        <div class="search-filter-controls">
          <input type="date" class="search-date" value=${options.since}
                 onInput=${(e) => updateOptions({ since: e.currentTarget.value })}/>
          <span class="search-filter-dash">→</span>
          <input type="date" class="search-date" value=${options.until}
                 onInput=${(e) => updateOptions({ until: e.currentTarget.value })}/>
          ${(options.since || options.until) ? html`
            <button class="search-link"
                    onClick=${() => updateOptions({ since: '', until: '' })}>any time</button>
          ` : null}
        </div>
      </div>
      <div class="search-filter-row">
        <div class="search-filter-label">Projects</div>
        <div class="search-filter-controls projects">
          <label class="search-chip">
            <input type="checkbox" checked=${allSelected}
                   onChange=${() => updateOptions({ project_ids: [] })}/>
            <span>All (${visible.length})</span>
          </label>
          ${visible.map(p => {
            const checked = !allSelected && (options.project_ids || []).includes(p.id);
            return html`
              <label key=${p.id} class="search-chip" title=${p.path}>
                <input type="checkbox" checked=${checked}
                       onChange=${() => toggleProject(p.id)}/>
                <span>${p.name || p.path.split('/').pop()}</span>
              </label>
            `;
          })}
        </div>
      </div>
      <div class="search-filter-footer">
        <button class="search-link" onClick=${onReset}>Reset filters</button>
      </div>
    </div>
  `;
}

function SearchBar({
  inputRef, query, setQuery, regex, setRegex, options, updateOptions,
  projects, showFilters, setShowFilters, busy, error, matchCount, onReset,
}) {
  const filterCount = (() => {
    let n = 0;
    if ((options.project_ids || []).length) n++;
    if (options.since || options.until) n++;
    if (options.mode === 'exclude') n++;
    const s = options.scope || {};
    if (s.projects === false || s.checkpoints === false || s.diffs === false) n++;
    return n;
  })();

  const onKey = (e) => {
    if (e.key === 'Escape') { setQuery(''); setShowFilters(false); e.currentTarget.blur(); }
  };

  const hasQuery = !!query.trim();
  const meta = error ? html`<span class="search-meta err">${error}</span>`
             : busy ? html`<span class="search-meta">searching…</span>`
             : (hasQuery && matchCount != null)
               ? html`<span class=${classes('search-meta', matchCount === 0 && 'zero')}>${matchCount}</span>`
               : null;

  return html`
    <div class="search">
      <div class=${classes('search-input-wrap', hasQuery && 'active')}>
        <span class="icon search-leading">search</span>
        <input ref=${inputRef}
               type="text"
               class="search-input"
               placeholder="Filter projects, checkpoints, diffs…"
               value=${query}
               onInput=${(e) => setQuery(e.currentTarget.value)}
               onKeyDown=${onKey}/>
        ${meta}
        <button class=${classes('search-toggle', regex && 'on')}
                title="Treat query as a regular expression"
                onClick=${() => setRegex(!regex)}>.*</button>
        <button class=${classes('search-toggle', showFilters && 'on')}
                title="Filters"
                onClick=${() => setShowFilters(!showFilters)}>
          <span class="icon sm">tune</span>
          ${filterCount ? html`<span class="search-filter-badge">${filterCount}</span>` : null}
        </button>
        ${hasQuery ? html`
          <button class="search-toggle clear"
                  title="Clear"
                  onClick=${() => setQuery('')}>
            <span class="icon sm">close</span>
          </button>
        ` : null}
      </div>
      ${showFilters ? html`
        <div class="search-filter-popup">
          <${SearchFilters} options=${options} updateOptions=${updateOptions}
                            projects=${projects} onReset=${onReset}/>
        </div>
      ` : null}
    </div>
  `;
}

// ---------- settings ----------

const SETTINGS_KEY = 'ckpt.settings';

// Theme descriptors used by both the picker UI and the runtime apply step.
// Keep `id` stable — it's what gets persisted into ckpt.settings.theme and
// written to document.documentElement.dataset.theme. The `:root` block in
// styles.css is treated as 'claude-dark' (no data-theme attribute set).
const THEMES = [
  { id: 'claude-dark',  label: 'Claude Dark',  swatch: ['#1a1a1a', '#262626', '#CC785C'] },
  { id: 'claude-light', label: 'Claude Light', swatch: ['#faf8f4', '#f3efe7', '#B85A3C'] },
  { id: 'github-dark',  label: 'GitHub Dark',  swatch: ['#0d1117', '#21262d', '#58a6ff'] },
  { id: 'github-light', label: 'GitHub Light', swatch: ['#ffffff', '#eaeef2', '#0969da'] },
];
const DEFAULT_THEME = 'claude-dark';

function applyTheme(themeId) {
  // Default theme = no attribute, so the :root rules take over verbatim.
  if (themeId === DEFAULT_THEME) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', themeId);
}

function loadSettings() {
  const defaults = { deleteLater: false, autoUpdate: false, hiddenSources: [], favoritesOnly: false, theme: DEFAULT_THEME };
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const theme = THEMES.find(t => t.id === s.theme) ? s.theme : defaults.theme;
    return {
      ...defaults, ...s,
      hiddenSources: Array.isArray(s.hiddenSources) ? s.hiddenSources : defaults.hiddenSources,
      favoritesOnly: !!s.favoritesOnly,
      theme,
    };
  } catch { return defaults; }
}

// Apply at module-load time so the document starts in the user's chosen
// theme — without this we'd get a brief flash of the default dark theme
// before the App effect runs.
applyTheme(loadSettings().theme);
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
        <div class="settings-section-title">Theme</div>
        <div class="theme-picker">
          ${THEMES.map(t => html`
            <label key=${t.id}
                   class=${classes('theme-option', settings.theme === t.id && 'active')}>
              <input type="radio" name="ckpt-theme"
                     checked=${settings.theme === t.id}
                     onChange=${() => updateSettings({ theme: t.id })}/>
              <span class="theme-swatch">
                <span style=${`background:${t.swatch[0]}`}></span>
                <span style=${`background:${t.swatch[1]}`}></span>
                <span style=${`background:${t.swatch[2]}`}></span>
              </span>
              <span class="theme-label">${t.label}</span>
            </label>
          `)}
        </div>
      </div>
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
  highlight = (t) => t,
  multiIds,
}) {
  if (!projects.length) {
    return html`<div class="empty">no projects yet — run Claude in a git repo</div>`;
  }
  const selected = multiIds || new Set();
  return html`
    <div>
      ${projects.map((p, i) => html`
        <div key=${p.id}
             class=${classes('project', selectedId === p.id && 'selected',
                             selected.has(p.id) && 'multi-selected',
                             !p.exists && 'missing')}
             onMouseDown=${suppressShiftSelect}
             onClick=${(e) => p.exists && onSelect(p.id, e)}
             title=${p.exists ? p.path : 'directory missing'}>
          ${p.exists ? html`
            <button class="kebab"
                    title="Project actions"
                    onClick=${(e) => { e.stopPropagation(); onOpenMenu(openMenuId === p.id ? null : p.id); }}>
              <span class="icon sm">more_vert</span>
            </button>
          ` : null}
          <div class="name"><span class="list-index">#${i + 1}</span>${highlight(p.name || p.path.split('/').pop())}</div>
          <div class="path">${highlight(p.path)}</div>
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

// Official brand SVGs for the source indicators. Both ship with their
// own fills (Anthropic terra-cotta + Codex purple-blue gradient), so we
// don't try to drive their hue via currentColor — the brand color IS the
// signal. The fixed-color stripes on the left edge of each row use the
// same hex so the row reads consistently from either edge.
const SOURCE_LOGOS = {
  claude: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><title>Claude</title><path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#D97757" fill-rule="nonzero"/></svg>`,
  codex:  `<svg viewBox="0 0 12 12" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><title>Codex</title><g transform="matrix(0.666662,0,0,0.666662,-1.999971,-1.999927)"><path d="M9.064,3.344C9.787,3.047 10.573,2.939 11.349,3.032C12.349,3.147 13.24,3.572 14.022,4.307C14.032,4.317 14.046,4.324 14.059,4.328C14.073,4.331 14.088,4.331 14.102,4.328C15.118,4.066 16.195,4.163 17.148,4.603L17.195,4.625L17.311,4.682C18.308,5.188 19.087,6.041 19.499,7.081C19.708,7.591 19.812,8.122 19.814,8.676C19.829,9.088 19.784,9.5 19.68,9.899C19.67,9.94 19.681,9.983 19.71,10.014C20.304,10.621 20.698,11.344 20.893,12.184C21.182,13.609 20.886,14.894 20.006,16.038L19.87,16.204C19.287,16.871 18.522,17.354 17.669,17.592C17.631,17.603 17.601,17.631 17.588,17.668C17.397,18.219 17.205,18.691 16.848,19.162C15.948,20.349 14.626,21.008 13.137,21C11.95,20.994 10.898,20.56 9.98,19.698C9.952,19.672 9.912,19.663 9.875,19.674C9.487,19.799 9.095,19.817 8.671,19.812C7.996,19.807 7.33,19.647 6.726,19.346C6.093,19.032 5.542,18.575 5.116,18.011C4.964,17.809 4.813,17.619 4.702,17.394C4.55,17.085 4.427,16.764 4.332,16.433C4.132,15.681 4.127,14.89 4.318,14.135C4.324,14.117 4.326,14.098 4.324,14.079C4.321,14.06 4.311,14.044 4.297,14.031C3.835,13.563 3.482,13 3.263,12.38C3.117,11.998 3.033,11.596 3.012,11.188C2.976,10.651 3.023,10.111 3.153,9.588C3.49,8.476 4.135,7.603 5.086,6.97C5.298,6.829 5.499,6.719 5.687,6.64C5.902,6.551 6.117,6.476 6.333,6.413C6.364,6.403 6.389,6.378 6.398,6.347C6.562,5.758 6.844,5.209 7.227,4.732C7.71,4.119 8.343,3.641 9.064,3.344ZM12.546,13.909C12.211,13.928 11.945,14.209 11.945,14.545C11.945,14.881 12.211,15.162 12.546,15.181L16.182,15.181C16.194,15.182 16.206,15.182 16.218,15.182C16.567,15.182 16.855,14.894 16.855,14.545C16.855,14.196 16.567,13.908 16.218,13.908C16.206,13.908 16.194,13.908 16.182,13.909L12.546,13.909ZM8.462,9.23C8.346,9.042 8.14,8.926 7.919,8.926C7.57,8.926 7.282,9.214 7.282,9.563C7.282,9.667 7.308,9.769 7.356,9.861L8.628,12.085L7.362,14.221C7.304,14.319 7.273,14.431 7.273,14.546C7.273,14.895 7.56,15.182 7.909,15.182C8.134,15.182 8.343,15.063 8.457,14.87L9.911,12.415C10.028,12.218 10.029,11.973 9.916,11.775L8.462,9.23Z" fill="url(#ckpt-codex-grad)" fill-rule="nonzero"/></g><defs><linearGradient id="ckpt-codex-grad" x1="0" y1="0" x2="1" y2="0" gradientUnits="userSpaceOnUse" gradientTransform="matrix(0,18,-18,0,12,3)"><stop offset="0" stop-color="#B1A7FF"/><stop offset=".5" stop-color="#7A9DFF"/><stop offset="1" stop-color="#3941FF"/></linearGradient></defs></svg>`,
};

function CheckpointRow({ ckpt, index, total, selected, multi, isNew, onSelect, onRestore, onDelete, onPruneHere, onStar, highlight = (t) => t }) {
  // The last visible row is the oldest; pruning there would keep everything → disable.
  const isOldest = index === total;
  // Source-aware row class: `source-codex` recolors the left stripe blue,
  // `source-claude` (or missing source) keeps the terra-cotta. Unknown
  // sources get a neutral stripe and the literal source name as a tooltip
  // on hover — see styles.css.
  const source = (ckpt.source || 'claude').toLowerCase();
  const sourceClass = `source-${source}`;
  const starred = !!ckpt.starred;
  return html`
    <div class=${classes('checkpoint', sourceClass, selected && 'selected',
                         multi && 'multi-selected', isNew && 'new', starred && 'starred')}
         title=${`source: ${source}`}
         onMouseDown=${suppressShiftSelect}
         onClick=${onSelect}>
      <div class="row1">
        ${SOURCE_LOGOS[source]
          ? html`<span class="source-icon" title=${`source: ${source}`}
                       dangerouslySetInnerHTML=${{ __html: SOURCE_LOGOS[source] }}></span>`
          : html`<span class="source-icon" title=${`source: ${source}`}>
                   <span class="icon sm">circle</span>
                 </span>`}
        <span class="list-index">#${index}</span>
        <span class="when">${ckpt.when}</span>
        <span class="id">${ckpt.id}</span>
        <button class=${classes('star', starred && 'on')}
                title=${starred ? 'Unfavorite' : 'Mark as favorite'}
                onClick=${(e) => { e.stopPropagation(); onStar(!starred); }}>
          <span class="icon sm">${starred ? 'star' : 'star_outline'}</span>
        </button>
      </div>
      <div class="msg">${highlight(ckpt.message)}</div>
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

function CheckpointList({ checkpoints, selectedId, newIds, onSelect, onRestore, onDelete, onPruneHere, onStar, highlight, multiIds }) {
  if (!checkpoints.length) {
    return html`<div class="empty">no checkpoints yet — the Stop hook creates one after each turn</div>`;
  }
  const selected = multiIds || new Set();
  return html`
    <div>
      ${checkpoints.map((c, i) => html`
        <${CheckpointRow}
          key=${c.id}
          ckpt=${c}
          index=${i + 1}
          total=${checkpoints.length}
          selected=${selectedId === c.id}
          multi=${selected.has(c.id)}
          isNew=${newIds.has(c.id)}
          onSelect=${(e) => onSelect(c.id, e)}
          onRestore=${() => onRestore(c)}
          onDelete=${() => onDelete(c)}
          onPruneHere=${() => onPruneHere(c, i + 1)}
          onStar=${(val) => onStar(c.id, val)}
          highlight=${highlight}
        />
      `)}
    </div>
  `;
}

// ---------- bulk action bar ----------
//
// Shown above a column's body when more than one row is multi-selected.
// `actions` is an array of `{label, icon, onClick, danger?}` objects; all
// of them collapse into a single "more_horiz" button that opens a menu —
// keeps the bar compact regardless of how many actions a column ships.

function BulkActionBar({ count, label, actions, onClear }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  if (!count || count < 2) return null;
  const items = (actions || []).filter(Boolean);
  return html`
    <div class="bulk-bar">
      <span class="bulk-count">${count} ${label}</span>
      <span class="bulk-spacer"></span>
      ${items.length ? html`
        <span class="bulk-actions" ref=${menuRef}>
          <button class=${classes('bulk-actions-btn', open && 'open')}
                  title="Actions"
                  onClick=${(e) => { e.stopPropagation(); setOpen(o => !o); }}>
            <span class="icon sm">more_horiz</span>
          </button>
          ${open ? html`
            <div class="bulk-actions-menu">
              ${items.map((a, i) => html`
                <button key=${i}
                        class=${classes('bulk-actions-item', a.danger && 'danger')}
                        onClick=${() => { setOpen(false); a.onClick?.(); }}>
                  ${a.icon ? html`<span class="icon sm">${a.icon}</span>` : null}
                  <span>${a.label}</span>
                </button>
              `)}
            </div>
          ` : null}
        </span>
      ` : null}
      <button class="bulk-clear" title="Clear selection" onClick=${onClear}>
        <span class="icon sm">close</span>
      </button>
    </div>
  `;
}

// ---------- source filter (Checkpoints column header) ----------

const KNOWN_SOURCES = ['claude', 'codex'];

// Order matters: known agents come first so the popup reads consistently;
// extra sources discovered in the data are appended in encounter order.
function collectSourceOptions(checkpoints) {
  const seen = new Map();
  for (const k of KNOWN_SOURCES) seen.set(k, true);
  for (const c of checkpoints) {
    const s = (c.source || 'claude').toLowerCase();
    if (!seen.has(s)) seen.set(s, true);
  }
  return [...seen.keys()];
}

function SourceFilterButton({ checkpoints, hiddenSources, setHidden, favoritesOnly, setFavoritesOnly }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const options = collectSourceOptions(checkpoints);
  const hidden = new Set(hiddenSources || []);
  const toggle = (src) => {
    const next = new Set(hidden);
    if (next.has(src)) next.delete(src); else next.add(src);
    setHidden([...next]);
  };
  const showAll  = () => setHidden([]);
  const hideAll  = () => setHidden(options);
  // Active count = any source hidden + favorites-only on. Drives the badge.
  const activeFilters = hidden.size + (favoritesOnly ? 1 : 0);
  return html`
    <span class="source-filter" ref=${ref}>
      <button class=${classes('source-filter-btn', activeFilters && 'active')}
              title="Filter checkpoints"
              onClick=${(e) => { e.stopPropagation(); setOpen(o => !o); }}>
        <span class="icon sm">filter_list</span>
        ${activeFilters ? html`<span class="source-filter-badge">${activeFilters}</span>` : null}
      </button>
      ${open ? html`
        <div class="source-filter-popup">
          <div class="source-filter-title">Show</div>
          <label class="source-filter-row source-favorite">
            <input type="checkbox" checked=${!!favoritesOnly}
                   onChange=${(e) => setFavoritesOnly(e.currentTarget.checked)}/>
            <span class="icon sm star-icon">star</span>
            <span class="source-name">favorites only</span>
          </label>
          <div class="source-filter-sep"></div>
          <div class="source-filter-title">Agent source</div>
          ${options.map(src => {
            const checked = !hidden.has(src);
            return html`
              <label key=${src} class=${classes('source-filter-row', `source-${src}`)}>
                <input type="checkbox" checked=${checked}
                       onChange=${() => toggle(src)}/>
                <span class="source-swatch"></span>
                <span class="source-name">${src}</span>
              </label>
            `;
          })}
          <div class="source-filter-actions">
            <button class="search-link" onClick=${showAll}>show all</button>
            <button class="search-link" onClick=${hideAll}>hide all</button>
          </div>
        </div>
      ` : null}
    </span>
  `;
}

// ---------- prompt pane ----------

function PromptPane({ prompt, ckpt, highlight = (t) => t }) {
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
      <div class="prompt-text">${highlight(prompt)}</div>
    </div>
  `;
}

// ---------- files column ----------

function FilesList({ files, totalFiles, filtering, selectedFile, ckptId, ckpt, onSelect, onRestoreFile, highlight = (t) => t, multiPaths, bulkBar = null }) {
  const stats = ckpt?.stats;
  const headerStats = stats && (stats.insertions || stats.deletions) ? html`
    <span class="header-stats">
      ${stats.insertions ? html`<span class="ins">+${stats.insertions}</span>` : null}
      ${stats.deletions  ? html`<span class="del">−${stats.deletions}</span>` : null}
    </span>
  ` : null;

  const total = totalFiles != null ? totalFiles : files.length;
  const countNode = filtering
    ? html`<span class="count">(${files.length} / ${total})</span>`
    : (total ? html`<span class="count">(${total})</span>` : null);

  return html`
    <div class="col">
      <div class="col-header">
        <span>Files ${countNode}</span>
        ${headerStats}
      </div>
      ${bulkBar}
      <div class="col-body">
        ${!ckptId
          ? html`<div class="empty">select a checkpoint</div>`
          : !total
            ? html`<div class="empty">no files changed in this checkpoint</div>`
            : !files.length
              ? html`<div class="empty">no files match the filter</div>`
              : files.map((f, i) => {
                const s = (f.status || '?')[0];
                const selected = (multiPaths || new Set()).has(f.path);
                return html`
                  <div key=${f.path}
                       class=${classes('file', selectedFile === f.path && 'selected', selected && 'multi-selected')}
                       onMouseDown=${suppressShiftSelect}
                       onClick=${(e) => onSelect(f.path, e)}>
                    <span class="list-index">#${i + 1}</span>
                    <span class=${`status ${s}`}>${s}</span>
                    <span class="path" title=${f.path}>${highlight(f.path)}</span>
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
  // Sync the chosen theme to <html data-theme="..."> any time it changes.
  // Mount-time apply is implicit because `settings` is initialized from
  // localStorage and this effect runs after the first render.
  useEffect(() => { applyTheme(settings.theme); }, [settings.theme]);
  const [showSettings, setShowSettings] = useState(false);

  // self-update
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateBusy, setUpdateBusy] = useState(false);

  // project-row kebab menu (one open at a time)
  const [openMenuId, setOpenMenuId] = useState(null);

  // Per-column multi-selection. Plain click sets a single-row selection
  // and fires the column's primary action (navigate); cmd/ctrl click
  // toggles; shift click selects a range. Bulk action toolbars appear
  // when more than one row is selected.
  const [projSel,  setProjSel]  = useState(EMPTY_SELECTION);
  const [ckptSel,  setCkptSel]  = useState(EMPTY_SELECTION);
  const [fileSel,  setFileSel]  = useState(EMPTY_SELECTION);
  const updateSettings = useCallback((patch) => {
    setSettingsState(prev => { const s = { ...prev, ...patch }; saveSettings(s); return s; });
  }, []);

  const lastIdsRef = useRef(new Set());

  // ---------- global search ----------
  const [searchQuery, setSearchQuery] = useState('');
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchOptions, setSearchOptions] = useState(DEFAULT_SEARCH_OPTIONS);
  const [showSearchFilters, setShowSearchFilters] = useState(false);
  const [searchResults, setSearchResults] = useState(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const searchInputRef = useRef(null);
  const searchSeqRef = useRef(0);

  const updateSearchOptions = useCallback((patch) => {
    setSearchOptions(prev => {
      const next = { ...prev, ...patch };
      if (patch.scope) next.scope = { ...(prev.scope || {}), ...patch.scope };
      return next;
    });
  }, []);

  const resetSearchOptions = useCallback(() => {
    setSearchOptions(DEFAULT_SEARCH_OPTIONS);
  }, []);

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
    setCkptSel(EMPTY_SELECTION);
    setFileSel(EMPTY_SELECTION);
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

  const selectCheckpoint = useCallback(async (id, preferredPath = null) => {
    setSelectedCkpt(id);
    setSelectedFile(null);
    setFiles([]); setDiff(null); setPrompt(null);
    // Switching checkpoints invalidates the file multi-selection.
    setFileSel(EMPTY_SELECTION);

    const base = apiBase(selectedProject);
    const [promptResp, filesResp] = await Promise.all([
      api.get(`${base}/checkpoints/${encodeURIComponent(id)}/prompt`).catch(() => ({ prompt: null })),
      api.get(`${base}/checkpoints/${encodeURIComponent(id)}/files`).catch(() => []),
    ]);
    setPrompt(promptResp?.prompt || null);
    if (Array.isArray(filesResp)) {
      setFiles(filesResp);
      const target = (preferredPath && filesResp.find(f => f.path === preferredPath))
        ? preferredPath
        : filesResp[0]?.path;
      if (target) selectFile(id, target);
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

  // Auto-select the newest checkpoint when nothing is selected — on first
  // load, after the selected one is deleted, after switching project, etc.
  // Must run after selectCheckpoint is defined so the dep array can resolve it.
  useEffect(() => {
    if (!selectedCkpt && checkpoints.length > 0) {
      selectCheckpoint(checkpoints[0].id);
    }
  }, [checkpoints, selectedCkpt, selectCheckpoint]);

  // Run a search whenever the query (or any option) changes. Debounced so
  // a fast typer doesn't fire one HTTP round-trip per keystroke.
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null); setSearchError(null); setSearchBusy(false);
      return;
    }
    const seq = ++searchSeqRef.current;
    setSearchBusy(true); setSearchError(null);
    const t = setTimeout(async () => {
      try {
        const r = await api.post('/api/search', {
          query: searchQuery,
          regex: searchRegex,
          scope: searchOptions.scope,
          project_ids: searchOptions.project_ids,
          since: searchOptions.since,
          until: searchOptions.until,
          mode: searchOptions.mode,
          max_results: 1000,
        });
        if (seq !== searchSeqRef.current) return;   // a newer search superseded us
        if (r?.ok) setSearchResults(r);
        else { setSearchResults(null); setSearchError(r?.error || 'search failed'); }
      } catch (e) {
        if (seq !== searchSeqRef.current) return;
        setSearchError(String(e?.message || e)); setSearchResults(null);
      } finally {
        if (seq === searchSeqRef.current) setSearchBusy(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery, searchRegex, searchOptions]);

  // Close the filter panel when the user clicks outside it.
  useEffect(() => {
    if (!showSearchFilters) return;
    const onDown = (e) => {
      if (e.target.closest('.search')) return;
      setShowSearchFilters(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showSearchFilters]);

  // Cmd/Ctrl+K focuses the search input from anywhere.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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

  // Toggle the favorite flag on a single checkpoint and refresh.
  const doStar = useCallback(async (ckptId, starred) => {
    if (!selectedProject || !ckptId) return;
    const r = await api.post(`${apiBase(selectedProject)}/checkpoints/${encodeURIComponent(ckptId)}/star`, { starred });
    if (r?.ok) refreshCkpts(true);
    else toast(r?.error || 'failed to update favorite', 'err');
  }, [selectedProject, refreshCkpts]);

  const doBulkStar = useCallback(async (starred) => {
    const ids = [...ckptSel.ids];
    if (!selectedProject || !ids.length) return;
    const r = await api.post(`${apiBase(selectedProject)}/checkpoints/bulk-star`, { ids, starred });
    if (r?.ok) {
      toast(`${starred ? 'favorited' : 'unfavorited'} ${r.updated}`, 'ok');
      refreshCkpts(true);
    } else toast(r?.error || 'bulk update failed', 'err');
  }, [selectedProject, ckptSel, refreshCkpts]);

  const doBulkDelete = useCallback(async () => {
    setModal(null);
    const ids = [...ckptSel.ids];
    if (!selectedProject || !ids.length) return;
    const r = await api.post(`${apiBase(selectedProject)}/checkpoints/bulk-delete`, { ids });
    if (r?.ok) {
      toast(`deleted ${r.deleted}`, 'ok');
      setCkptSel(EMPTY_SELECTION);
      if (ids.includes(selectedCkpt)) {
        setSelectedCkpt(null); setFiles([]); setSelectedFile(null); setDiff(null); setPrompt(null);
      }
      refreshCkpts(true);
    } else toast(r?.error || 'bulk delete failed', 'err');
  }, [selectedProject, selectedCkpt, ckptSel, refreshCkpts]);

  const doBulkRestoreFiles = useCallback(async () => {
    setModal(null);
    const paths = [...fileSel.ids];
    if (!selectedProject || !selectedCkpt || !paths.length) return;
    const r = await api.post(
      `${apiBase(selectedProject)}/checkpoints/${encodeURIComponent(selectedCkpt)}/bulk-restore-files`,
      { paths },
    );
    if (r?.ok) toast(`restored ${r.restored?.length || 0} file(s)`, 'ok');
    else toast((r?.errors?.[0]?.error) || r?.error || 'bulk restore failed', 'err');
  }, [selectedProject, selectedCkpt, fileSel]);

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

  const openBulkDelete = () => {
    const n = ckptSel.ids.size;
    setModal({
      title: `Delete ${n} checkpoints`,
      body: html`
        <p>Remove <strong>${n}</strong> selected checkpoint${n === 1 ? '' : 's'}?</p>
        <p class="muted">Working tree unchanged. The snapshots are gone for good.</p>
      `,
      actions: html`
        <button onClick=${() => setModal(null)}>Cancel</button>
        <button class="danger solid" onClick=${doBulkDelete}>Delete ${n}</button>
      `,
    });
  };

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

  // Derive filter sets from the latest search response. When the query is
  // empty `searchFilter` is null and every column renders as normal.
  //
  // Visibility rules:
  //   - A project shows up if anything in it matched.
  //   - A checkpoint shows up if its message/prompt matched, or any of its
  //     file diffs matched. If the project matched only by name (no children
  //     hit), all of its checkpoints stay visible — otherwise selecting the
  //     project would land on an empty list.
  //   - A file shows up if its diff matched. If the checkpoint matched only
  //     by message (no diff hit), all of its files stay visible. Same fall-
  //     through applies when only the project matched.
  const searchFilter = useMemo(() => {
    if (!searchQuery.trim() || !searchResults?.matches) return null;
    const allProjects = new Set();
    const projectsWithChild = new Set();
    const matchedCkpts = new Set();
    const ckptsWithChild = new Set();
    const matchedFiles = new Set();
    for (const m of searchResults.matches) {
      if (!m.project_id) continue;
      allProjects.add(m.project_id);
      if (m.kind === 'checkpoint' || m.kind === 'diff') {
        projectsWithChild.add(m.project_id);
        if (m.checkpoint_id) matchedCkpts.add(`${m.project_id}|${m.checkpoint_id}`);
      }
      if (m.kind === 'diff' && m.checkpoint_id) {
        ckptsWithChild.add(`${m.project_id}|${m.checkpoint_id}`);
        if (m.file_path) matchedFiles.add(`${m.project_id}|${m.checkpoint_id}|${m.file_path}`);
      }
    }
    return {
      isProjectVisible: (pid) => allProjects.has(pid),
      isCheckpointVisible: (pid, cid) =>
        !projectsWithChild.has(pid) || matchedCkpts.has(`${pid}|${cid}`),
      isFileVisible: (pid, cid, path) => {
        if (!projectsWithChild.has(pid)) return true;
        if (!ckptsWithChild.has(`${pid}|${cid}`)) return true;
        return matchedFiles.has(`${pid}|${cid}|${path}`);
      },
    };
  }, [searchQuery, searchResults]);

  const existingProjects = projects.filter(p => p.exists);
  const visibleProjects = searchFilter
    ? projects.filter(p => searchFilter.isProjectVisible(p.id))
    : projects;
  // Three filters compose on Checkpoints: search query, per-source toggle,
  // favorites-only. All apply independently; row must pass every one.
  const hiddenSources = new Set((settings.hiddenSources || []).map(s => s.toLowerCase()));
  const favoritesOnly = !!settings.favoritesOnly;
  const visibleCheckpoints = checkpoints.filter(c => {
    const src = (c.source || 'claude').toLowerCase();
    if (hiddenSources.has(src)) return false;
    if (favoritesOnly && !c.starred) return false;
    if (searchFilter && selectedProject &&
        !searchFilter.isCheckpointVisible(selectedProject, c.id)) return false;
    return true;
  });
  const visibleFiles = (searchFilter && selectedProject && selectedCkpt)
    ? files.filter(f => searchFilter.isFileVisible(selectedProject, selectedCkpt, f.path))
    : files;
  const matchCount = searchResults?.stats?.match_count ?? 0;
  const highlight = useMemo(
    () => makeHighlighter(searchQuery, searchRegex),
    [searchQuery, searchRegex],
  );

  const countLabel = (visible, total) =>
    searchFilter ? html`<span class="count">(${visible} / ${total})</span>`
                 : html`<span class="count">(${total})</span>`;

  // Column click handlers — plain click also navigates, cmd/shift only
  // touches the multi-selection state. orderedIds is the column's currently
  // visible row order so shift-range walks what the user sees.
  const onProjectRowClick = useCallback((id, e) => {
    const orderedIds = visibleProjects.filter(p => p.exists).map(p => p.id);
    setProjSel(prev => selectionFromClick(prev, id, orderedIds, e));
    if (!isMultiClick(e)) setSelectedProject(id);
  }, [visibleProjects]);

  const onCheckpointRowClick = useCallback((id, e) => {
    const orderedIds = visibleCheckpoints.map(c => c.id);
    setCkptSel(prev => selectionFromClick(prev, id, orderedIds, e));
    if (!isMultiClick(e)) selectCheckpoint(id);
  }, [visibleCheckpoints, selectCheckpoint]);

  const onFileRowClick = useCallback((path, e) => {
    const orderedIds = visibleFiles.map(f => f.path);
    setFileSel(prev => selectionFromClick(prev, path, orderedIds, e));
    if (!isMultiClick(e) && selectedCkpt) selectFile(selectedCkpt, path);
  }, [visibleFiles, selectedCkpt, selectFile]);

  return html`
    <div class="app">
      <${Header}
        branch=${status.branch}
        live=${liveState}
        search=${html`
          <${SearchBar}
            inputRef=${searchInputRef}
            query=${searchQuery}
            setQuery=${setSearchQuery}
            regex=${searchRegex}
            setRegex=${setSearchRegex}
            options=${searchOptions}
            updateOptions=${updateSearchOptions}
            projects=${projects}
            showFilters=${showSearchFilters}
            setShowFilters=${setShowSearchFilters}
            busy=${searchBusy}
            error=${searchError}
            matchCount=${searchQuery.trim() ? matchCount : null}
            onReset=${resetSearchOptions}/>
        `}
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
          <div class="col-header">Projects ${countLabel(
            visibleProjects.filter(p => p.exists).length, existingProjects.length
          )}</div>
          <${BulkActionBar}
            count=${projSel.ids.size}
            label=${projSel.ids.size === 1 ? 'project' : 'projects'}
            onClear=${() => setProjSel(EMPTY_SELECTION)}
            actions=${null}
          />
          <div class="col-body">
            <${ProjectList}
              projects=${visibleProjects}
              selectedId=${selectedProject}
              openMenuId=${openMenuId}
              onSelect=${onProjectRowClick}
              onOpenMenu=${setOpenMenuId}
              onCloseMenu=${() => setOpenMenuId(null)}
              onPruneProject=${openPruneProject}
              onUndoProject=${openUndoProject}
              onCleanProject=${openCleanProject}
              highlight=${highlight}
              multiIds=${projSel.ids}
            />
          </div>
        </div>
        <div class="col">
          <div class="col-header">
            <span>Checkpoints ${countLabel(visibleCheckpoints.length, checkpoints.length)}</span>
            <${SourceFilterButton}
              checkpoints=${checkpoints}
              hiddenSources=${settings.hiddenSources}
              setHidden=${(arr) => updateSettings({ hiddenSources: arr })}
              favoritesOnly=${!!settings.favoritesOnly}
              setFavoritesOnly=${(v) => updateSettings({ favoritesOnly: v })}/>
          </div>
          <${BulkActionBar}
            count=${ckptSel.ids.size}
            label=${ckptSel.ids.size === 1 ? 'checkpoint' : 'checkpoints'}
            onClear=${() => setCkptSel(EMPTY_SELECTION)}
            actions=${[
              { label: 'Favorite',   icon: 'star',         onClick: () => doBulkStar(true) },
              { label: 'Unfavorite', icon: 'star_outline', onClick: () => doBulkStar(false) },
              { label: 'Delete',     icon: 'delete',       onClick: openBulkDelete, danger: true },
            ]}
          />
          <div class="col-body">
            <${CheckpointList}
              checkpoints=${visibleCheckpoints}
              selectedId=${selectedCkpt}
              newIds=${newIds}
              onSelect=${onCheckpointRowClick}
              onRestore=${openRestore}
              onDelete=${openDelete}
              onPruneHere=${openPruneHere}
              onStar=${doStar}
              highlight=${highlight}
              multiIds=${ckptSel.ids}
            />
          </div>
        </div>
        <div class="main-right">
          <${PromptPane} prompt=${prompt} ckpt=${selCkpt} highlight=${highlight}/>
          <div class="main-right-bottom">
            <${FilesList}
              files=${visibleFiles}
              totalFiles=${files.length}
              filtering=${!!searchFilter}
              selectedFile=${selectedFile}
              ckptId=${selectedCkpt}
              ckpt=${selCkpt}
              onSelect=${onFileRowClick}
              onRestoreFile=${openRestoreFile}
              highlight=${highlight}
              multiPaths=${fileSel.ids}
              bulkBar=${html`
                <${BulkActionBar}
                  count=${fileSel.ids.size}
                  label=${fileSel.ids.size === 1 ? 'file' : 'files'}
                  onClear=${() => setFileSel(EMPTY_SELECTION)}
                  actions=${[
                    { label: `Restore ${fileSel.ids.size}`, icon: 'restore', onClick: doBulkRestoreFiles },
                  ]}/>
              `}
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
