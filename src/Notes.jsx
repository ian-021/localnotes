import React from 'react';
import { THEMES, id, seed, touched, fmtDay, fmtTime, CMDS, HELP, slugOf, reslug, splitTitle, flatThoughts, countThoughts, findThought } from './data.js';
import { lookup, hasKey, FIELDS } from './ai.js';

// [tag] tags the bracketed words with themselves; [some words](tag) tags them with a different name
const LINK_RE = /\[([^\[\]\n]+)\](?:\(([^()\n]+)\))?/g;
const norm = name => String(name || '').replace(/^#/, '').trim().toLowerCase();
const tagsOf = text => [...String(text || '').matchAll(LINK_RE)].map(m => norm(m[2] || m[1])).filter(Boolean);
const qn = (bk, qq) => 'q' + String(bk.quotes.indexOf(qq) + 1).padStart(2, '0');
const SECS = ['quotes', 'vocab'];

// line helpers for the buffer: start / end of the line holding position p, first non-blank of that line
const lsOf = (t, p) => t.lastIndexOf('\n', p - 1) + 1;
const leOf = (t, p) => { const i = t.indexOf('\n', p); return i < 0 ? t.length : i; };
const firstNBOf = (t, p) => { let i = lsOf(t, p); const e = leOf(t, p); while (i < e && /[ \t]/.test(t[i])) i++; return i; };
// `:git commit -m testing git` without quotes: the words after -m are the message, up to the next flag (git would read them as paths)
const commitMsg = (args, raw) => { const i = args.findIndex(a => /^(-[a-zA-Z]*m|--message)$/.test(a)); if (args[0] !== 'commit' || i < 0 || /\s(-[a-zA-Z]*m|--message)\s+["']/.test(raw)) return args; let j = i + 1; while (j + 1 < args.length && !args[j + 1].startsWith('-')) j++; return [...args.slice(0, i + 1), args.slice(i + 1, j + 1).join(' '), ...args.slice(j + 1)]; };
// one line out of a git run for the status bar: the first useful line of stdout (stderr on failure), status/log/push shaped by hand
const gitSummary = ({ args, out, err, code }) => {
  const first = str => (str || '').split('\n').map(l => l.trim()).filter(l => l && !/^(To |remote:|hint:|warning:)/i.test(l))[0] || '';
  if (code !== 0) return first(err) || first(out) || `exit ${code}`;
  const lines = out.split('\n').filter(l => l.trim());
  if (args[0] === 'status' && lines[0] && lines[0].startsWith('## ')) { const n = lines.length - 1; return `${lines[0].slice(3)} · ${n ? n + (n === 1 ? ' change' : ' changes') : 'clean'}`; }
  if (args[0] === 'status') return /nothing to commit/.test(out) ? 'clean' : `${lines.filter(l => /^\s+(modified|new file|deleted|renamed):|^\?\?/.test(l)).length || '?'} changes`;
  if (args[0] === 'log') return lines.length ? `${lines[0]}${lines.length > 1 ? ` · ${lines.length} shown` : ''}` : 'no commits';
  if (args[0] === 'push' || args[0] === 'pull' || args[0] === 'fetch') return first(err.replace(/^\s*[0-9a-f]+\.\.[0-9a-f]+\s+/m, '')) || first(out) || 'ok';
  return first(out) || first(err) || 'ok';
};
const VMODES = { normal: 'NORMAL', insert: 'INSERT', visual: 'VISUAL', vline: 'V-LINE' };
// shell-style argument split for :git — quotes group words, backslash escapes inside them: commit -m "a message"
const splitArgs = str => { const out = []; let cur = null, q = null; for (let i = 0; i < str.length; i++) { const ch = str[i]; if (q) { if (ch === q) q = null; else if (ch === '\\' && q === '"' && i + 1 < str.length) cur += str[++i]; else cur += ch; } else if (ch === '"' || ch === "'") { q = ch; cur = cur ?? ''; } else if (/\s/.test(ch)) { if (cur !== null) { out.push(cur); cur = null; } } else if (ch === '\\' && i + 1 < str.length) cur = (cur ?? '') + str[++i]; else cur = (cur ?? '') + ch; } if (cur !== null) out.push(cur); return out; };
// text objects: iw aw iW aW ip ap and the bracket / quote pairs → [start, end) or null
const OBJ_PAIRS = { '(': '()', ')': '()', b: '()', '[': '[]', ']': '[]', '{': '{}', '}': '{}', B: '{}', '<': '<>', '>': '<>', '"': '""', "'": "''", '`': '``' };
const charClass = ch => /\s/.test(ch) ? 0 : /[\p{L}\p{N}_]/u.test(ch) ? 1 : 2;
const textObject = (t, c, inner, ch) => {
  const n = t.length; if (!n) return null; c = Math.min(c, n - 1);
  const ls = lsOf(t, c), le = leOf(t, c);
  if (ch === 'w' || ch === 'W') {
    const k = ch === 'W' ? x => (/\s/.test(x) ? 0 : 1) : charClass, k0 = k(t[c]); let a = c, b = c + 1;
    while (a > ls && k(t[a - 1]) === k0) a--; while (b < le && k(t[b]) === k0) b++;
    if (inner) return [a, b];
    if (k0 === 0) { const k1 = b < le ? k(t[b]) : null; while (b < le && k(t[b]) === k1) b++; return [a, b]; }   // on blanks: the blanks plus the next word
    let b2 = b; while (b2 < le && /\s/.test(t[b2])) b2++;
    if (b2 > b) return [a, b2];
    while (a > ls && /\s/.test(t[a - 1])) a--; return [a, b];   // no trailing blanks: take the leading ones
  }
  if (ch === 'p') {
    const blankAt = p => /^\s*$/.test(t.slice(lsOf(t, p), leOf(t, p))), on = blankAt(c); let a = ls, b = le;
    while (a > 0 && blankAt(a - 1) === on) a = lsOf(t, a - 1);
    while (b < n && blankAt(b + 1) === on) b = leOf(t, b + 1);
    b = Math.min(n, b + 1);
    if (!inner) while (b < n && blankAt(b)) b = Math.min(n, leOf(t, b) + 1);
    return [a, b];
  }
  const pair = OBJ_PAIRS[ch]; if (!pair) return null; const [o, cl] = pair;
  if (o === cl) {   // quotes: pair them up along the line, take the pair around (or after) the cursor
    const qs = []; for (let i = ls; i < le; i++) if (t[i] === o) qs.push(i);
    for (let i = 0; i + 1 < qs.length; i += 2) if (qs[i + 1] >= c || i + 2 >= qs.length) { const [a, b] = [qs[i], qs[i + 1]]; return b < c && i + 2 >= qs.length ? null : inner ? [a + 1, b] : [a, b + 1]; }
    return null;
  }
  let depth = 0, a = -1, b = -1;
  for (let i = t[c] === cl ? c - 1 : c; i >= 0; i--) { if (t[i] === cl) depth++; else if (t[i] === o) { if (!depth) { a = i; break; } depth--; } }
  if (a < 0) return null; depth = 0;
  for (let i = a + 1; i < n; i++) { if (t[i] === o) depth++; else if (t[i] === cl) { if (!depth) { b = i; break; } depth--; } }
  if (b < 0) return null;
  return inner ? [a + 1, b] : [a, b + 1];
};
export default class Notes extends React.Component {
  constructor(p) {
    super(p);
    let data = null, ui = {};
    try { data = JSON.parse(localStorage.getItem('notes.data.v1')); ui = JSON.parse(localStorage.getItem('notes.ui.v1')) || {}; } catch (e) {}
    if (Array.isArray(data)) { data.forEach(b => { if (!b.author) { const [t, a] = splitTitle(b.title); if (a) { b.title = t; b.author = a; } } }); reslug(data); }
    this.state = {
      books: data || seed(), theme: ui.theme || p.theme || 'light', sidebar: ui.sidebar ?? (p.sidebarOpen ?? true), nu: ui.nu ?? true,
      view: { type: 'library' }, cur: 0, side: 0, expanded: ui.expanded || {}, focus: 'main', mode: 'normal', pending: '', count: '',
      cmd: '', search: '', filter: '', msg: '', vanchor: null, long: null, longText: '', help: false,
      hover: null, aiBusy: null, archive: null, archiveState: '', git: { busy: null }, cmdc: 0, histIdx: null, histDraft: '', fields: null,
    };
    this.undo = []; this.longRef = React.createRef(); this.mirrorRef = React.createRef();
    try { this.hist = JSON.parse(localStorage.getItem('notes.hist.v1')) || []; } catch (e) { this.hist = []; }
  }
  componentDidMount() {
    this.onKey = e => this.key(e); this.onCopy = e => this.copy(e); this.onPaste = e => this.paste(e);
    window.addEventListener('keydown', this.onKey); window.addEventListener('copy', this.onCopy); window.addEventListener('paste', this.onPaste);
    this.applyBody(); this.loadArchive();
  }
  // ---- archive: a folder of Markdown files served by the dev server (archive.js). Loaded at startup, written on every change.
  async loadArchive(manual) {
    let r; try { r = await fetch('/api/archive'); } catch (e) { return this.setState({ archive: null, archiveState: '' }); }
    if (!r.ok) return this.setState({ archive: null, archiveState: '' });
    const { dir, books } = await r.json();
    if (books) { books.forEach(b => { if (!b.author) { const [t, a] = splitTitle(b.title); if (a) { b.title = t; b.author = a; } } }); reslug(books); this.skipSave = true; this.undo = []; this.setState({ books, archive: dir, archiveState: 'saved', view: manual ? { type: 'library' } : this.state.view, cur: manual ? 0 : this.state.cur, msg: `${books.length} ${books.length === 1 ? 'book' : 'books'} from ${dir}` }); }
    else { this.setState({ archive: dir, archiveState: 'saved', msg: `new archive at ${dir}` }, () => { if (this.state.books.length) this.saveArchive(); }); }
  }
  queueSave() { clearTimeout(this.st); this.setState({ archiveState: 'unsaved' }); this.st = setTimeout(() => this.saveArchive(), 400); }
  async saveArchive() {
    clearTimeout(this.st); const s = this.state; if (!s.archive) return false;
    this.setState({ archiveState: 'saving' });
    try { const r = await fetch('/api/archive', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s.books) }); if (!r.ok) throw new Error((await r.json()).error || r.statusText); this.setState({ archiveState: this.state.books === s.books ? 'saved' : this.state.archiveState }); return true; }
    catch (e) { this.setState({ archiveState: 'error', msg: 'archive write failed: ' + e.message }); return false; }
  }
  componentWillUnmount() { clearTimeout(this.st); window.removeEventListener('keydown', this.onKey); window.removeEventListener('copy', this.onCopy); window.removeEventListener('paste', this.onPaste); clearTimeout(this.pt); clearTimeout(this.ht); }
  componentDidUpdate() {
    const s = this.state, ps = this.prev || {}; this.prev = s;
    if (ps.theme !== s.theme) this.applyBody();
    if (s.long && !ps.long && this.longRef.current) this.longRef.current.focus();
    if (s.long) this.syncMirror();
    if (s.books !== ps.books) { try { localStorage.setItem('notes.data.v1', JSON.stringify(s.books)); } catch (e) {} if (s.archive && !this.skipSave) this.queueSave(); this.skipSave = false; }
    if (ps.theme !== s.theme || ps.sidebar !== s.sidebar || ps.nu !== s.nu || ps.expanded !== s.expanded) try { localStorage.setItem('notes.ui.v1', JSON.stringify({ theme: s.theme, sidebar: s.sidebar, nu: s.nu, expanded: s.expanded })); } catch (e) {}
  }
  setState(u, cb) {
    super.setState(typeof u === 'function' ? u : (s => u), () => {
      const n = this.items().length, c = this.state.cur, sn = this.sideList().length, sc = this.state.side, fix = {};
      if (n && c > n - 1) fix.cur = n - 1;
      if (sn && sc > sn - 1) fix.side = sn - 1;
      if (Object.keys(fix).length) super.setState(fix, cb); else if (cb) cb();
    });
  }
  applyBody() { document.body.style.background = THEMES[this.state.theme].bg; }
  // ---- data helpers
  book() { const v = this.state.view; return this.state.books.find(b => b.id === v.bookId); }
  quote() { const b = this.book(); return b && b.quotes.find(q => q.id === this.state.view.quoteId); }
  word() { const b = this.book(); return b && b.vocab.find(w => w.id === this.state.view.wordId); }
  // ---- AI word lookup (cached on the word itself, no undo entry)
  openWord(bookId, wordId) {
    const s = this.state, from = s.view.type === 'word' ? s.view.from : { view: s.view, cur: s.cur };
    this.setState({ view: { type: 'word', bookId, wordId, from }, cur: 0, focus: 'main', filter: '', msg: '', hover: null, mode: 'normal', vanchor: null, help: false, ...this.sidePos(bookId, 'vocab') }, () => this.loadAI(false));
  }
  loadAI(force) {
    const s = this.state, v = s.view, b = this.book(), w = this.word(); if (v.type !== 'word' || !b || !w) return;
    if (!hasKey()) return this.setState({ msg: 'no VITE_OPENAI_API_KEY in .env · copy .env.example, add a key, restart dev server' });
    if (!force && w.ai) return;
    if (s.aiBusy === w.id) return;
    this.setState({ aiBusy: w.id, msg: force ? 'asking again…' : 'asking openai…' });
    lookup(w.word, w.def, b).then(ai => {
      const books = JSON.parse(JSON.stringify(this.state.books)); const bb = books.find(x => x.id === b.id), ww = bb && bb.vocab.find(x => x.id === w.id);
      if (!ww) return this.setState({ aiBusy: null });
      ww.ai = ai; this.setState({ books, aiBusy: null, msg: '' });
    }).catch(e => this.setState({ aiBusy: null, msg: String(e.message || e) }));
  }
  // sidebar tree: each book is a folder holding a quotes node and a vocab node
  sideList(s = this.state) { const out = []; s.books.forEach((b, bi) => { out.push({ kind: 'book', b, bi }); if (s.expanded[b.id]) SECS.forEach(sec => out.push({ kind: 'sec', b, bi, sec })); }); out.push({ kind: 'all', b: {} }); return out; }
  sidePos(bookId, sec, s = this.state) {
    const expanded = sec && !s.expanded[bookId] ? { ...s.expanded, [bookId]: true } : s.expanded;
    const i = this.sideList({ books: s.books, expanded }).findIndex(n => n.b.id === bookId && (sec ? n.kind === 'sec' && n.sec === sec : n.kind === 'book'));
    return { side: Math.max(0, i), expanded };
  }
  tagIndex(books = this.state.books) {
    const idx = new Map();
    const add = (name, ref) => { const k = norm(name); if (!k) return; let e = idx.get(k); if (!e) idx.set(k, e = { name: k, refs: [] }); if (!e.refs.some(r => r.id === ref.id)) e.refs.push(ref); };
    books.forEach(bk => {
      const bref = { kind: 'book', bookId: bk.id, id: bk.id, label: bk.slug, text: bk.title };
      bk.tags.forEach(t => add(t, bref)); tagsOf(bk.title).forEach(t => add(t, bref));
      bk.quotes.forEach(qq => {
        const qref = { kind: 'quote', bookId: bk.id, quoteId: qq.id, id: qq.id, label: `${bk.slug}/${qn(bk, qq)}`, text: qq.text };
        tagsOf(qq.text).forEach(t => add(t, qref));
        flatThoughts(qq).forEach(({ t }) => { const tref = { kind: 'thought', bookId: bk.id, quoteId: qq.id, id: t.id, label: `${bk.slug}/${qn(bk, qq)}`, text: t.text }; tagsOf(t.text).forEach(n => add(n, tref)); });
      });
      bk.vocab.forEach(w => { const wref = { kind: 'vocab', bookId: bk.id, id: w.id, label: `${bk.slug}/v`, text: `${w.word} — ${w.def}` }; tagsOf(w.word + ' ' + w.def).forEach(t => add(t, wref)); });
    });
    return idx;
  }
  items() {
    const s = this.state, v = s.view, f = s.filter.toLowerCase();
    const hit = str => !f || str.toLowerCase().includes(f);
    if (v.type === 'library') return s.books.filter(b => hit(b.title + ' ' + b.author + ' ' + b.tags.join(' '))).map(b => ({ kind: 'book', b }));
    if (v.type === 'book') { const b = this.book(); if (!b) return []; return v.sec === 'vocab' ? b.vocab.filter(w => hit(w.word + ' ' + w.def)).map(w => ({ kind: 'vocab', b, w })) : b.quotes.filter(q => hit(q.text)).map(q => ({ kind: 'quote', b, q })); }
    if (v.type === 'vocab') return s.books.flatMap(b => b.vocab.map(w => ({ kind: 'vocab', b, w }))).filter(it => hit(it.w.word + ' ' + it.w.def + ' ' + it.b.slug + ' ' + it.b.tags.join(' '))).sort((x, y) => x.w.word.localeCompare(y.w.word));
    if (v.type === 'thread') { const q = this.quote(); if (!q) return []; return flatThoughts(q).filter(x => hit(x.t.text)).map(x => ({ kind: 'thought', q, t: x.t, depth: x.depth })); }
    if (v.type === 'tag') { const e = this.tagIndex().get(v.tag); return e ? e.refs.filter(r => hit(r.label + ' ' + r.text)).map(r => ({ kind: 'ref', r })) : []; }
    return [];
  }
  mutate(fn) { this.undo.push(JSON.stringify(this.state.books)); if (this.undo.length > 50) this.undo.shift(); const books = JSON.parse(JSON.stringify(this.state.books)); fn(books); this.setState({ books }); }
  clamp(cur, n) { return Math.max(0, Math.min(n - 1, cur)); }
  // ---- navigation
  goRef(r) {
    const bs = this.state.books, bk = bs.find(b => b.id === r.bookId); if (!bk) return this.setState({ msg: 'that item is gone', hover: null });
    const base = { focus: 'main', filter: '', msg: '', mode: 'normal', vanchor: null, hover: null, help: false, ...this.sidePos(bk.id, r.kind === 'vocab' ? 'vocab' : 'quotes') };
    if (r.kind === 'book') return this.setState({ ...base, view: { type: 'book', bookId: bk.id, sec: 'quotes' }, cur: 0 });
    if (r.kind === 'vocab') return this.setState({ ...base, view: { type: 'book', bookId: bk.id, sec: 'vocab' }, cur: Math.max(0, bk.vocab.findIndex(w => w.id === r.id)) });
    const qq = bk.quotes.find(q => q.id === r.quoteId); if (!qq) return this.setState({ msg: 'that quote is gone', hover: null });
    if (r.kind === 'quote') return this.setState({ ...base, view: { type: 'thread', bookId: bk.id, quoteId: qq.id }, cur: 0 });
    return this.setState({ ...base, view: { type: 'thread', bookId: bk.id, quoteId: qq.id }, cur: Math.max(0, flatThoughts(qq).findIndex(x => x.t.id === r.id)) });
  }
  // ---- git: `:git <args>` runs git inside the archive folder through the dev server (POST /api/git). Nothing opens: the
  // result is one line in the status bar, `git <cmd> · ok · <first line>` or `git <cmd> · failed · <first error line>`.
  // `:commit [msg]` is add + commit + push in one go. Commands that change the working tree reload the archive afterwards.
  async runGit(args, opts = {}) {
    const s = this.state;
    if (!s.archive) { this.setState({ msg: 'no archive · git needs the dev server' }); return null; }
    if (s.git.busy) { this.setState({ msg: `git ${s.git.busy} still running` }); return null; }
    if (s.archiveState === 'unsaved' || s.archiveState === 'saving') await this.saveArchive();   // commit what is on screen, not what was on disk 400ms ago
    const name = args[0] || '';
    this.setState({ git: { busy: name }, msg: `git ${name}…` });
    let r;
    try { const res = await fetch('/api/git', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args }) }); r = await res.json(); if (!res.ok) throw new Error(r.error || res.statusText); }
    catch (e) { r = { code: 1, out: '', err: String(e.message || e) }; }
    const run = { args, out: r.out || '', err: r.err || '', code: r.code };
    const ok = run.code === 0, msg = ok && opts.quiet ? this.state.msg : `git ${name} · ${ok ? 'ok' : 'failed'} · ${gitSummary(run)}`;
    this.setState({ git: { busy: null }, msg: msg.length > 160 ? msg.slice(0, 157) + '…' : msg });
    if (ok && /^(pull|checkout|switch|merge|reset|rebase|stash|revert|restore|cherry-pick)$/.test(name)) this.loadArchive(false);
    return run;
  }
  async gitCommit(message) {
    const msg = message || 'notes · ' + new Date().toISOString().slice(0, 16).replace('T', ' ');
    if (!(await this.runGit(['add', '-A'], { quiet: true }))) return;
    const st = await this.runGit(['status', '--porcelain'], { quiet: true }); if (!st || st.code !== 0) return;
    if (!st.out.trim()) return this.setState({ msg: 'git · nothing to commit · working tree clean' });
    const c = await this.runGit(['commit', '-m', msg], { quiet: true }); if (!c || c.code !== 0) return;
    const p = await this.runGit(['push'], { quiet: true }); if (p && p.code === 0) this.setState({ msg: `git · committed and pushed · "${msg}"` });
  }
  openTag(name) {
    const s = this.state, k = norm(name); if (!k) return;
    const from = s.view.type === 'tag' ? s.view.from : { view: s.view, cur: s.cur };
    this.setState({ view: { type: 'tag', tag: k, from }, cur: 0, focus: 'main', filter: '', msg: '', hover: null, mode: 'normal', vanchor: null, help: false });
  }
  goView(view, cur = 0) { this.setState({ view, cur, focus: 'main', filter: '', msg: '', hover: null, mode: 'normal', vanchor: null, ...(view.bookId ? this.sidePos(view.bookId, view.sec || 'quotes') : view.type === 'vocab' ? { side: this.sideList().length - 1 } : {}) }); }
  open(drillOnly = false) {
    const s = this.state, it = this.items()[s.cur];
    if (s.focus === 'side') {
      const n = this.sideList()[s.side]; if (!n) return;
      if (n.kind === 'book') { const ex = !!s.expanded[n.b.id]; if (drillOnly && ex) return; return this.setState({ expanded: { ...s.expanded, [n.b.id]: !ex }, msg: '' }); }
      if (n.kind === 'all') { if (!drillOnly && s.view.type === 'vocab') return this.setState({ view: { type: 'empty' }, cur: 0, filter: '', msg: '' }); return this.setState({ view: { type: 'vocab' }, cur: 0, filter: '', msg: '' }); }
      if (!drillOnly && s.view.type === 'book' && s.view.bookId === n.b.id && s.view.sec === n.sec) return this.setState({ view: { type: 'empty' }, cur: 0, filter: '', msg: '' });
      return this.setState({ view: { type: 'book', bookId: n.b.id, sec: n.sec }, cur: 0, filter: '', msg: '' });
    }
    if (!it) return;
    if (it.kind === 'ref') return this.goRef(it.r);
    if (it.kind === 'book') this.setState({ view: { type: 'book', bookId: it.b.id, sec: 'quotes' }, cur: 0, filter: '', msg: '', ...this.sidePos(it.b.id, 'quotes') });
    else if (it.kind === 'quote') this.setState({ view: { type: 'thread', bookId: it.b.id, quoteId: it.q.id }, cur: 0, filter: '', msg: '' });
    else if (it.kind === 'vocab') this.openWord(it.b.id, it.w.id);
    else if (!drillOnly) this.startEdit();
  }
  sideUp() {
    const s = this.state, list = this.sideList(), n = list[s.side]; if (!n) return;
    if (n.kind === 'sec') return this.setState({ side: list.findIndex(x => x.kind === 'book' && x.bi === n.bi) });
    if (s.expanded[n.b.id]) this.setState({ expanded: { ...s.expanded, [n.b.id]: false } });
  }
  back() {
    const s = this.state, v = s.view;
    if (v.type === 'thread') { const b = this.book(); this.setState({ view: { type: 'book', bookId: v.bookId, sec: 'quotes' }, cur: b ? b.quotes.findIndex(q => q.id === v.quoteId) : 0, filter: '', msg: '' }); }
    else if (v.type === 'book') this.setState({ view: { type: 'library' }, cur: this.state.books.findIndex(b => b.id === v.bookId), filter: '', msg: '' });
    else if (v.type === 'empty' || v.type === 'vocab') this.setState({ view: { type: 'library' }, cur: 0, filter: '', msg: '' });
    else if (v.type === 'tag' || v.type === 'word') this.setState({ view: v.from ? v.from.view : { type: 'library' }, cur: v.from ? v.from.cur : 0, filter: '', msg: '', hover: null, ...(v.from && v.from.view.bookId ? this.sidePos(v.from.view.bookId, v.from.view.sec || 'quotes') : {}) });
    else this.setState({ msg: 'already at ~/notes' });
  }
  focusPane(pane) {
    const s = this.state;
    if (pane === 'side') { if (s.focus === 'side') return; return this.setState({ sidebar: true, focus: 'side', mode: 'normal', vanchor: null, msg: '' }); }
    if (s.focus === 'main') return; return this.setState({ focus: 'main', msg: '' });
  }
  // ---- the buffer: one vim-style editor for every piece of text. Nothing is written until :w / :wq.
  //   book → line 1 title, line 2 author · vocab → line 1 word, definition below · quote / thought → free text
  bufText(kind, o) { return kind === 'book' ? o.title + (o.author ? '\n' + o.author : '') : kind === 'vocab' ? o.word + '\n' + o.def : o.text; }
  itemId(it) { return it.kind === 'book' ? it.b.id : it.kind === 'quote' ? it.q.id : it.kind === 'vocab' ? it.w.id : it.kind === 'thought' ? it.t.id : it.r.id; }
  openBuf(spec, text, vmode = 'normal', caret = 0) {
    const L = { ...spec, vmode, saved: text, undo: [], redo: [], pending: '', c: 0, vanchor: null, caret: 0, tagSel: 0, tagPopClosed: true };
    this.setState({ long: L, longText: text, mode: 'normal', vanchor: null, msg: '', help: false, hover: null }, () => this.setC(caret, { vmode }));
  }
  startEdit(where = 'normal') {   // where: 'normal' | 'start' | 'end'
    const it = this.items()[this.state.cur]; if (!it) return;
    if (it.kind === 'ref') return this.goRef(it.r);
    const o = it.kind === 'book' ? it.b : it.kind === 'quote' ? it.q : it.kind === 'vocab' ? it.w : it.t, text = this.bufText(it.kind, o);
    this.openBuf({ kind: it.kind, isNew: false, id: o.id, bookId: it.b ? it.b.id : this.state.view.bookId, quoteId: it.kind === 'thought' ? it.q.id : undefined }, text, where === 'normal' ? 'normal' : 'insert', where === 'end' ? text.length : 0);
  }
  // ---- new book: two inline fields, title then author, Enter after each (the one thing not typed in the buffer: it is a form, not a text).
  // "Title - Author" in the first field fills both; an empty author skips it; Esc cancels.
  startBook() { this.setState({ mode: 'fields', fields: { step: 'title', title: '', text: '', pos: 0 }, focus: 'main', vanchor: null, msg: '', help: false }); }
  fieldsSet(text, pos) { this.setState({ fields: { ...this.state.fields, text, pos } }); }
  fieldsDone() {
    const s = this.state, f = s.fields; if (!f) return;
    const text = f.text.trim();
    if (f.step === 'title') {
      if (!text) return this.setState({ mode: 'normal', fields: null, msg: '' });
      const [title, author] = splitTitle(text);
      if (author) return this.addBook(title, author);
      return this.setState({ fields: { step: 'author', title, text: '', pos: 0 }, msg: '' });
    }
    this.addBook(f.title, text);
  }
  addBook(title, author) { const n = this.state.books.length; this.writeBuf({ kind: 'book', isNew: true }, author ? title + '\n' + author : title); this.setState({ mode: 'normal', fields: null, cur: n, msg: `"${title}"${author ? ' — ' + author : ''} created` }); }
  fieldsKey(k) {
    const f = this.state.fields, t = f.text, p = Math.min(f.pos, t.length);
    if (k === 'Escape') return this.setState({ mode: 'normal', fields: null, msg: '' });
    if (k === 'Enter') return this.fieldsDone();
    if (k === 'Backspace') { if (!p) return; return this.fieldsSet(t.slice(0, p - 1) + t.slice(p), p - 1); }
    if (k === 'Delete') return this.fieldsSet(t.slice(0, p) + t.slice(p + 1), p);
    if (k === 'ArrowLeft') return this.fieldsSet(t, Math.max(0, p - 1));
    if (k === 'ArrowRight') return this.fieldsSet(t, Math.min(t.length, p + 1));
    if (k === 'Home') return this.fieldsSet(t, 0);
    if (k === 'End') return this.fieldsSet(t, t.length);
    if (k.length === 1) return this.fieldsSet(t.slice(0, p) + k + t.slice(p), p + 1);
  }
  fieldsShortcut(e) { const f = this.state.fields, r = this.lineShortcut(e, f.text, Math.min(f.pos, f.text.length)); if (!r) return false; e.preventDefault(); this.fieldsSet(r.text, r.pos); return true; }
  startNew(kind, text = '', vmode = 'insert', extra = {}) { const v = this.state.view; this.openBuf({ kind, isNew: true, bookId: v.bookId, quoteId: v.quoteId, ...extra }, text, vmode, text.length); }
  // thread: `o` adds a sibling after the thought under the cursor, `a` a reply beneath it
  newThought(reply) { const it = this.items()[this.state.cur]; this.startNew('thought', '', 'insert', it ? (reply ? { parentId: it.t.id } : { afterId: it.t.id }) : {}); }
  newHere() {
    const v = this.state.view;
    if (v.type === 'library') this.startBook();
    else if (v.type === 'book') this.startNew(v.sec === 'vocab' ? 'vocab' : 'quote');
    else if (v.type === 'thread') this.newThought(false);
    else if (v.type === 'tag') this.setState({ msg: 'open an item to add to it' });
    else if (v.type === 'vocab') this.setState({ msg: 'open a word to add to its book · :def inside a book' });
    else if (v.type === 'word') this.setState({ msg: 'q to go back · r to ask again' });
    else if (v.type === 'empty') this.setState({ msg: 'open a book first' });
  }
  // write a buffer into the data; returns the id of the item written, or null when there was nothing to write
  writeBuf(spec, raw) {
    const text = raw.replace(/\r\n/g, '\n').trim(); if (!text) return null;
    const v = this.state.view, bookId = spec.bookId || v.bookId, quoteId = spec.quoteId || v.quoteId;
    const [l1, ...more] = text.split('\n'), line1 = l1.trim(), rest = more.join('\n').trim();
    let wid = spec.id;
    this.mutate(bs => {
      const b = bs.find(x => x.id === bookId);
      if (spec.kind === 'book') {
        const [title, author] = rest ? [line1, rest] : splitTitle(line1);
        if (spec.isNew) { wid = id(); bs.push({ id: wid, slug: slugOf(title, bs.map(x => x.slug)), title, author, tags: [], quotes: [], vocab: [] }); }
        else { const bb = bs.find(x => x.id === spec.id); bb.title = title; bb.author = author; bb.slug = slugOf(title, bs.filter(x => x !== bb).map(x => x.slug)); }
      } else if (spec.kind === 'quote') {
        if (spec.isNew) { wid = id(); b.quotes.push({ id: wid, text, page: null, thoughts: [] }); } else b.quotes.find(q => q.id === spec.id).text = text;
      } else if (spec.kind === 'vocab') {
        if (spec.isNew) { wid = id(); b.vocab.push({ id: wid, word: line1, def: rest, at: Date.now() }); } else { const w = b.vocab.find(w => w.id === spec.id); w.word = line1; w.def = rest; }
      } else {
        const q = b.quotes.find(q => q.id === quoteId);
        if (spec.isNew) {
          wid = id(); const node = { id: wid, text, at: Date.now(), thoughts: [] }, f = findThought(q, spec.parentId || spec.afterId);
          if (spec.parentId && f) (f.t.thoughts = f.t.thoughts || []).push(node); else if (spec.afterId && f) f.list.splice(f.i + 1, 0, node); else q.thoughts.push(node);
        } else { const f = findThought(q, spec.id); if (f) f.t.text = text; }
      }
    });
    return wid;
  }
  writeLong() {
    const s = this.state, L = s.long; if (!L) return false;
    const wid = this.writeBuf(L, s.longText); if (!wid) return false;
    this.setState({ long: { ...L, isNew: false, id: wid, saved: s.longText } });
    return wid;
  }
  closeLong(wid) {
    const s = this.state, L = s.long || {}, v = s.view, idv = wid || (L.isNew ? null : L.id);
    const next = { long: null, longText: '', mode: 'normal', cmd: '' };
    // a quote or word written from the other section of the book: switch to where it lives
    if (idv && v.type === 'book' && (L.kind === 'quote' || L.kind === 'vocab')) { const sec = L.kind === 'vocab' ? 'vocab' : 'quotes'; if ((v.sec || 'quotes') !== sec) Object.assign(next, { view: { ...v, sec } }, this.sidePos(v.bookId, sec)); }
    this.setState(next, () => { if (!idv) return; const i = this.items().findIndex(it => this.itemId(it) === idv); if (i >= 0) this.setState({ cur: i }); });
  }
  commitLong() {
    const s = this.state; if (!s.long) return;
    const wid = this.writeLong();
    this.closeLong(wid || undefined);
    this.setState({ msg: wid ? 'written' : s.longText.trim() ? '' : 'discarded (empty)' });
  }
  longEl() { return this.longRef.current; }
  // cursor: normal mode shows a one-character block (a selection), visual modes the range, insert mode the native caret
  selRange(L, t) {
    if (L.vmode === 'visual') return [Math.min(L.c, L.vanchor), Math.min(t.length, Math.max(L.c, L.vanchor) + 1)];
    if (L.vmode === 'vline') return [lsOf(t, Math.min(L.c, L.vanchor)), leOf(t, Math.max(L.c, L.vanchor))];
    return [L.c, Math.min(t.length, L.c + 1)];
  }
  applySel(L = this.state.long) {
    const el = this.longEl(); if (!el || !L) return;
    if (document.activeElement !== el) el.focus();
    if (L.vmode === 'insert') { el.setSelectionRange(L.c, L.c); return this.scrollTo(L.c); }
    const [a, b] = this.selRange(L, el.value);
    el.setSelectionRange(a, b, L.vmode !== 'normal' && L.c < L.vanchor ? 'backward' : 'forward');
    this.scrollTo(L.c);
  }
  // move the cursor (and optionally replace the text / change mode); clamps like vim: normal mode stays on a character
  setC(c, extra = {}, text) {
    const L = this.state.long; if (!L) return;
    const t = text !== undefined ? text : this.state.longText, vmode = extra.vmode || L.vmode;
    c = Math.max(0, Math.min(c, vmode === 'insert' ? t.length : Math.max(0, t.length - 1)));
    const nl = { ...L, pending: '', wantX: null, ...extra, vmode, c, caret: c };
    this.setState({ long: nl, ...(text !== undefined ? { longText: text, msg: '' } : {}) }, () => this.applySel(nl));
  }
  // visual-line movement (j / k through wrapped lines): positions are measured in a hidden mirror of the textarea
  // the mirror holds the same text split into spans (tag highlights), so an index has to be located across its text nodes
  nodeAt(m, i) {
    const w = document.createTreeWalker(m, NodeFilter.SHOW_TEXT); let n, last = null;
    while ((n = w.nextNode())) { if (i < n.length) return [n, i]; i -= n.length; last = n; }
    return last ? [last, last.length] : null;
  }
  // the mirror is 0.02px wider than the textarea: at an exact fit (a line as wide as the box) Chrome lets the textarea keep the
  // line but breaks it in a div; one layout unit of slack makes both wrap identically (checked across thousands of widths)
  syncMirror() { const m = this.mirrorRef.current, el = this.longEl(); if (!m || !el) return; const w = (el.getBoundingClientRect().width - (el.offsetWidth - el.clientWidth) + 0.02).toFixed(3) + 'px'; if (m.style.width !== w) m.style.width = w; }
  // character index under a viewport point, hit-tested in the mirror — the layer that is actually drawn (Chrome 128+, Firefox)
  idxAt(x, y) {
    const m = this.mirrorRef.current; if (!m || !document.caretPositionFromPoint) return null;
    m.style.pointerEvents = 'auto'; let r; try { r = document.caretPositionFromPoint(x, y); } finally { m.style.pointerEvents = ''; }
    if (!r || !m.contains(r.offsetNode)) return null;
    const rg = document.createRange(); rg.setStart(m, 0); rg.setEnd(r.offsetNode, r.offset);
    return Math.min(rg.toString().length, this.state.longText.length);
  }
  posOf(i) {
    const m = this.mirrorRef.current, el = this.longEl(); if (!m || !el || !m.textContent) return null;
    this.syncMirror();
    i = Math.max(0, Math.min(i, m.textContent.length - 1));
    const a = this.nodeAt(m, i), b2 = this.nodeAt(m, i + 1); if (!a || !b2) return null;
    const r = document.createRange(); r.setStart(a[0], a[1]); r.setEnd(b2[0], b2[1]);
    const b = r.getClientRects()[0] || r.getBoundingClientRect(), mb = m.getBoundingClientRect();
    return { x: b.left - mb.left, y: b.top - mb.top, h: parseFloat(getComputedStyle(el).lineHeight) || b.height || 20 };
  }
  // j / k by wrapped line, by hit-testing the mirror (what is drawn); falls back to measuring it with ranges.
  // Returns { to, wantX } — wantX is the column to keep on the next j / k.
  visualMove(c, dir) {
    const el = this.longEl(), L = this.state.long; if (!el) return null;
    if (!document.caretPositionFromPoint) { const to = this.visualMoveMirror(c, dir); return to == null ? null : { to, wantX: null }; }
    const h = parseFloat(getComputedStyle(el).lineHeight) || 20, R = el.getBoundingClientRect(), x0 = R.left + 1, x1 = R.right - 1;
    const pad = parseFloat(getComputedStyle(el).paddingTop) || 0, rowY = k => R.top + pad + k * h - el.scrollTop + h / 2, inBox = y => y > R.top && y < R.bottom;
    const first = k => this.idxAt(x0, rowY(k));   // first index on row k
    // the cursor's row: the last visible row that starts at or before c
    let k0 = Math.floor(el.scrollTop / h), row = null;
    for (let k = k0; inBox(rowY(k)); k++) { const i = first(k); if (i == null) break; if (i <= c) row = k; else break; }
    if (row === null) return null;
    let wantX = L.wantX;
    if (wantX == null) {   // the cursor's x: the centre of the span of points that snap to c, plus a quarter character
      const y = rowY(row); let lo = x0, hi = x1;
      while (hi - lo > 0.5) { const mid = (lo + hi) / 2; if ((this.idxAt(mid, y) ?? c) >= c) hi = mid; else lo = mid; }
      const xa = hi; lo = xa; hi = x1;
      while (hi - lo > 0.5) { const mid = (lo + hi) / 2; if ((this.idxAt(mid, y) ?? c + 1) >= c + 1) hi = mid; else lo = mid; }
      wantX = (xa + hi) / 2 - R.left + (hi - xa) / 4;
    }
    const target = row + dir; if (target < 0) return null;
    if (!inBox(rowY(target))) { el.scrollTop = Math.max(0, el.scrollTop + dir * h); if (!inBox(rowY(target))) return null; }
    const ft = first(target), fr = first(row), len = this.state.longText.length; if (ft == null || (dir > 0 ? ft <= fr : ft >= fr)) return null;   // no such row
    if (dir > 0 && ft === len && this.state.longText[len - 1] !== '\n') return null;   // below the last line the hit-test snaps to the end
    const to = this.idxAt(Math.min(x1, Math.max(x0, R.left + wantX)), rowY(target)); if (to == null) return null;
    return { to: Math.min(to, this.state.longText.length), wantX };
  }
  visualMoveMirror(c, dir) {
    const t = this.state.longText, p = this.posOf(c); if (!p) return null;
    const row = i => { const q = this.posOf(i); return q ? Math.round(q.y / p.h) : -1; }, R = row(c) + dir; if (R < 0) return null;
    let lo = dir > 0 ? c : 0, hi = dir > 0 ? t.length : c;   // rows grow with the index: find the first index on row R
    while (lo < hi) { const mid = (lo + hi) >> 1; if (row(mid) < R) lo = mid + 1; else hi = mid; }
    if (row(lo) !== R) return null;
    let best = lo, bd = Infinity;
    for (let i = lo; i <= t.length && row(i) === R; i++) { if (t[i] === '\n' && i > lo) break; const x = this.posOf(i).x, d = Math.abs(x - p.x); if (d < bd) { bd = d; best = i; } if (x > p.x) break; }
    return best;
  }
  scrollTo(c) { const el = this.longEl(), p = this.posOf(c); if (!el || !p) return; if (p.y < el.scrollTop) el.scrollTop = p.y; else if (p.y + p.h > el.scrollTop + el.clientHeight) el.scrollTop = p.y + p.h - el.clientHeight; }
  longUndo() { const L = this.state.long, t = this.state.longText; if (!L.undo.length) return this.setState({ msg: 'already at oldest change' }); const u = L.undo[L.undo.length - 1]; this.setC(u.c, { vmode: 'normal', vanchor: null, undo: L.undo.slice(0, -1), redo: [...L.redo, { t, c: L.c }] }, u.t); }
  longRedo() { const L = this.state.long, t = this.state.longText; if (!L.redo.length) return this.setState({ msg: 'already at newest change' }); const u = L.redo[L.redo.length - 1]; this.setC(u.c, { vmode: 'normal', vanchor: null, redo: L.redo.slice(0, -1), undo: [...L.undo, { t, c: L.c }] }, u.t); }
  longPaste(raw, after = true) {
    const s = this.state, L = s.long, t = s.longText; if (!L || !raw) return;
    const c = L.c, snap = [...L.undo, { t, c }].slice(-50), ex = { vmode: 'normal', vanchor: null, undo: snap, redo: [] };
    if (raw.endsWith('\n')) {   // linewise: a whole line below / above
      const body = raw.replace(/\n$/, ''), atEnd = after && leOf(t, c) === t.length, at = after ? leOf(t, c) + 1 : lsOf(t, c);
      return atEnd ? this.setC(t.length + 1, ex, t + '\n' + body) : this.setC(at, ex, t.slice(0, at) + body + '\n' + t.slice(at));
    }
    const at = after && t.length && t[c] !== '\n' ? c + 1 : c;
    this.setC(at + raw.length - 1, ex, t.slice(0, at) + raw + t.slice(at));
  }
  longKey(e) {
    const s = this.state, L = s.long, k = e.key, t = s.longText;
    if (['Shift', 'CapsLock', 'Meta', 'Alt', 'Control'].includes(k)) return;
    if (L.vmode === 'insert') return this.insertKey(e);
    e.preventDefault();
    const c = L.c, vis = L.vmode === 'visual' || L.vmode === 'vline';
    const ls = p => lsOf(t, p), le = p => leOf(t, p), firstNB = p => firstNBOf(t, p);
    const snap = [...L.undo, { t, c }].slice(-50);
    const clear = () => this.setState({ long: { ...L, pending: '' }, msg: '', help: false });
    const go = m => this.setC(m.to, m.keep ? { wantX: m.wantX } : {});
    const ins = to => this.setC(to, { vmode: 'insert', vanchor: null, undo: snap, redo: [], tagPopClosed: true });
    const yank = str => { try { navigator.clipboard.writeText(str); } catch (e) {} };
    const wordFwd = i => { while (i < t.length && /\S/.test(t[i])) i++; while (i < t.length && /\s/.test(t[i])) i++; return i; };
    const wordBack = i => { while (i > 0 && /\s/.test(t[i - 1])) i--; while (i > 0 && /\S/.test(t[i - 1])) i--; return i; };
    const wordEnd = i => { i++; while (i < t.length && /\s/.test(t[i])) i++; while (i + 1 < t.length && /\S/.test(t[i + 1])) i++; return Math.min(i, Math.max(0, t.length - 1)); };
    const curWordEnd = i => { while (i + 1 < t.length && /\S/.test(t[i + 1])) i++; return i; };
    // motions → { to, incl, line }: where the cursor goes, or what an operator covers
    const motion = (key, op) => {
      switch (key) {
        case 'h': case 'ArrowLeft': return { to: Math.max(ls(c), c - 1) };
        case 'Backspace': return { to: Math.max(0, c - 1) };
        case 'l': case 'ArrowRight': return { to: op ? Math.min(c + 1, le(c)) : Math.min(c + 1, Math.max(ls(c), le(c) - 1)) };
        case ' ': return { to: Math.min(c + 1, t.length) };
        case 'w': return op === 'c' && /\S/.test(t[c] || '') ? { to: curWordEnd(c), incl: true } : { to: op ? Math.min(wordFwd(c), le(c)) : wordFwd(c) };
        case 'b': return { to: wordBack(c) };
        case 'e': return { to: wordEnd(c), incl: true };
        case '0': case 'Home': return { to: ls(c) };
        case '^': return { to: firstNB(c) };
        case '$': case 'End': return { to: op ? le(c) : Math.max(ls(c), le(c) - 1) };
        case 'j': case 'ArrowDown': return op ? { to: Math.min(t.length, le(c) + 1), line: true } : { ...(this.visualMove(c, 1) || { to: null }), keep: true };
        case 'k': case 'ArrowUp': return op ? { to: Math.max(0, ls(c) - 1), line: true } : { ...(this.visualMove(c, -1) || { to: null }), keep: true };
        case 'Enter': return op ? { to: Math.min(t.length, le(c) + 1), line: true } : { to: le(c) < t.length ? firstNB(le(c) + 1) : null };
        case 'G': return { to: op ? t.length : firstNB(t.length), line: true };
        case 'gg': return { to: op ? 0 : firstNB(0), line: true };
      }
      return null;
    };
    const opRange = m => { let a = Math.min(c, m.to), b = Math.max(c, m.to); if (m.line) { a = ls(a); b = Math.min(t.length, le(b) + 1); } else if (m.incl) b = Math.min(t.length, b + 1); return [a, b]; };
    const doOp = (op, [a, b], linewise) => {
      a = Math.max(0, a); b = Math.min(t.length, b);
      const snap = [...L.undo, { t, c: a }].slice(-50);   // undo puts the cursor back where the change started
      if (op === 'y') { if (a >= b) return clear(); let str = t.slice(a, b); if (linewise && !str.endsWith('\n')) str += '\n'; yank(str); const n = str.split('\n').length - 1; this.setC(a, { vmode: 'normal', vanchor: null }); return this.setState({ msg: linewise ? `${n} ${n === 1 ? 'line' : 'lines'} yanked` : 'yanked' }); }
      if (op === 'c') { if (linewise && b > a && t[b - 1] === '\n') b--; return this.setC(a, { vmode: 'insert', vanchor: null, undo: snap, redo: [], tagPopClosed: true }, t.slice(0, a) + t.slice(b)); }
      if (a >= b) return clear();
      if (linewise && b === t.length && a > 0) a--;   // the last line takes the newline before it
      const nt = t.slice(0, a) + t.slice(b);
      return this.setC(linewise ? firstNBOf(nt, Math.min(a, nt.length)) : Math.min(a, Math.max(lsOf(nt, a), leOf(nt, a) - 1)), { vmode: 'normal', vanchor: null, undo: snap, redo: [] }, nt);
    };
    const paste = after => { if (!navigator.clipboard || !navigator.clipboard.readText) return this.setState({ msg: 'clipboard unavailable · use ⌘v' }); navigator.clipboard.readText().then(r => this.longPaste(r, after)).catch(() => this.setState({ msg: 'clipboard unavailable · use ⌘v' })); };
    if (k === 'Escape') return vis ? this.setC(c, { vmode: 'normal', vanchor: null }) : clear();
    if (L.pending) {   // an operator (d c y) or g waiting for its motion; doubled operator = the line
      const op = L.pending[0], rest = L.pending.slice(1);
      if (op === 'i' || op === 'a') { const r = textObject(t, c, op === 'i', k); if (!r || r[0] >= r[1]) return clear(); return this.setC(r[1] - 1, { vanchor: r[0], vmode: k === 'p' ? 'vline' : 'visual' }); }   // visual: viw, vi( …
      if (op === 'g') return k === 'g' ? go(motion('gg')) : clear();
      if (rest === 'g') return k === 'g' ? doOp(op, opRange(motion('gg', op)), true) : clear();
      if (rest === 'i' || rest === 'a') { const r = textObject(t, c, rest === 'i', k); if (!r) return clear(); return doOp(op, r, k === 'p'); }   // ciw, daw, yi( …
      if (k === 'g' || k === 'i' || k === 'a') return this.setState({ long: { ...L, pending: op + k } });
      if (k === op) return doOp(op, [ls(c), Math.min(t.length, le(c) + 1)], true);
      const m = motion(k, op); if (!m || m.to == null) return clear();
      return doOp(op, opRange(m), !!m.line);
    }
    if (vis) {
      const lo = Math.min(c, L.vanchor), hi = Math.max(c, L.vanchor), lw = L.vmode === 'vline', R = lw ? [ls(lo), Math.min(t.length, le(hi) + 1)] : [lo, Math.min(t.length, hi + 1)];
      switch (k) {
        case 'd': case 'x': case 'X': return doOp('d', R, lw);
        case 'y': return doOp('y', R, lw);
        case 'c': case 's': return doOp('c', R, lw);
        case 't': { const [a, b] = lw ? [R[0], Math.max(R[0], t[R[1] - 1] === '\n' ? R[1] - 1 : R[1])] : R; return this.setC(b + 3, { vmode: 'insert', vanchor: null, undo: [...L.undo, { t, c: a }].slice(-50), redo: [], tagPopClosed: false, tagSel: 0 }, t.slice(0, a) + '[' + t.slice(a, b) + '](' + t.slice(b)); }
        case 'v': return this.setC(c, L.vmode === 'visual' ? { vmode: 'normal', vanchor: null } : { vmode: 'visual' });
        case 'V': return this.setC(c, L.vmode === 'vline' ? { vmode: 'normal', vanchor: null } : { vmode: 'vline' });
        case 'o': return this.setC(L.vanchor, { vanchor: c });
        case 'g': case 'i': case 'a': return this.setState({ long: { ...L, pending: k } });
        case ':': return this.setState({ mode: 'command', cmd: '', cmdc: 0, histIdx: null, msg: '', help: false });
        default: { const m = motion(k); if (m && m.to != null) return go(m); return; }
      }
    }
    switch (k) {
      case 'i': return ins(c);
      case 'a': return ins(c < t.length && t[c] !== '\n' ? c + 1 : c);
      case 'I': return ins(firstNB(c));
      case 'A': return ins(le(c));
      case 'o': { const b = le(c); return this.setC(b + 1, { vmode: 'insert', vanchor: null, undo: snap, redo: [], tagPopClosed: true }, t.slice(0, b) + '\n' + t.slice(b)); }
      case 'O': { const a = ls(c); return this.setC(a, { vmode: 'insert', vanchor: null, undo: snap, redo: [], tagPopClosed: true }, t.slice(0, a) + '\n' + t.slice(a)); }
      case 'x': return doOp('d', [c, Math.min(c + 1, le(c))], false);
      case 'X': return c > ls(c) ? doOp('d', [c - 1, c], false) : undefined;
      case 's': return doOp('c', [c, Math.min(c + 1, le(c))], false);
      case 'S': return doOp('c', [ls(c), Math.min(t.length, le(c) + 1)], true);
      case 'D': return doOp('d', [c, le(c)], false);
      case 'C': return doOp('c', [c, le(c)], false);
      case 'Y': return doOp('y', [ls(c), Math.min(t.length, le(c) + 1)], true);
      case 'J': { const b = le(c); if (b >= t.length) return; return this.setC(b, { vmode: 'normal', undo: snap, redo: [] }, t.slice(0, b) + ' ' + t.slice(firstNB(b + 1))); }
      case 'd': case 'c': case 'y': case 'g': return this.setState({ long: { ...L, pending: k } });
      case 'v': return this.setC(c, { vmode: 'visual', vanchor: c });
      case 'V': return this.setC(c, { vmode: 'vline', vanchor: c });
      case 'p': return paste(true);
      case 'P': return paste(false);
      case 'u': return this.longUndo();
      case ':': return this.setState({ mode: 'command', cmd: '', cmdc: 0, histIdx: null, msg: '', help: false });
      case '?': return this.setState({ help: !s.help });
      default: { const m = motion(k); if (m && m.to != null) return go(m); }
    }
  }
  // insert mode: the textarea owns the caret; only Esc, Tab and the [tag] popup are handled here
  insertKey(e) {
    const s = this.state, L = s.long, k = e.key, el = this.longEl(), t = s.longText;
    const tq = this.tagQuery(), opts = tq !== null ? this.tagOptions(tq.q) : [];
    if (opts.length) {
      if (k === 'Enter') { e.preventDefault(); return this.acceptTag(opts[L.tagSel % opts.length]); }
      if (k === 'Tab' || k === 'ArrowDown') { e.preventDefault(); return this.setState({ long: { ...L, tagSel: (L.tagSel + 1) % opts.length } }); }
      if (k === 'ArrowUp') { e.preventDefault(); return this.setState({ long: { ...L, tagSel: (L.tagSel + opts.length - 1) % opts.length } }); }
      if (k === 'Escape') { e.preventDefault(); return this.setState({ long: { ...L, tagPopClosed: true, tagSel: 0 } }); }
    }
    if (k === 'Escape') { e.preventDefault(); const p = el ? el.selectionStart : t.length; return this.setC(p > lsOf(t, p) ? p - 1 : p, { vmode: 'normal', vanchor: null, tagPopClosed: true }); }
    if (k === 'Tab') return e.preventDefault();
    const p = el ? el.selectionStart : t.length, insAt = i => this.setC(i, { vmode: 'insert' });
    if (k === 'Home') { e.preventDefault(); return insAt(lsOf(t, p)); }
    if (k === 'End') { e.preventDefault(); return insAt(leOf(t, p)); }
    if (k === 'ArrowUp' || k === 'ArrowDown') { e.preventDefault(); const m = this.visualMove(p, k === 'ArrowDown' ? 1 : -1); if (m && m.to != null) this.setC(m.to, { vmode: 'insert', wantX: m.wantX }); return; }
    if (k === '[' || k === '(') this.setState({ long: { ...L, tagPopClosed: false, tagSel: 0 } });
  }
  deleteRange(a, b) {
    const its = this.items().slice(Math.min(a, b), Math.max(a, b) + 1); if (!its.length) return;
    const v = this.state.view;
    if (its.some(it => it.kind === 'ref')) return this.setState({ mode: 'normal', vanchor: null, msg: 'open the item to delete it from its book' });
    this.mutate(bs => {
      its.forEach(it => {
        if (it.kind === 'book') bs.splice(bs.findIndex(x => x.id === it.b.id), 1);
        else { const bb = bs.find(x => x.id === (it.b ? it.b.id : v.bookId));
          if (it.kind === 'quote') bb.quotes.splice(bb.quotes.findIndex(q => q.id === it.q.id), 1);
          else if (it.kind === 'vocab') bb.vocab.splice(bb.vocab.findIndex(w => w.id === it.w.id), 1);
          else { const f = findThought(bb.quotes.find(q => q.id === v.quoteId), it.t.id); if (f) f.list.splice(f.i, 1); } }
      });
    });
    this.setState({ cur: Math.min(a, b), mode: 'normal', vanchor: null, msg: `${its.length} ${its.length === 1 ? 'line' : 'lines'} deleted · u to undo` });
  }
  undoOnce() {
    const s = this.state, prev = this.undo.pop(); if (!prev) return this.setState({ msg: 'already at oldest change' });
    const books = JSON.parse(prev); const v = s.view; const ok = !v.bookId || books.some(b => b.id === v.bookId);
    this.setState({ books, msg: 'undone', view: ok ? v : { type: 'library' }, cur: Math.min(s.cur, this.itemsFor(books).length - 1) });
  }
  settle() {
    const s = this.state;
    if (s.long) return this.commitLong();
    if (s.mode === 'fields') return this.fieldsDone();
    if (s.mode === 'command' || s.mode === 'search') return this.setState({ mode: 'normal', cmd: '', filter: s.mode === 'command' ? s.filter : s.search });
    if (s.mode === 'visual') return this.setState({ mode: 'normal', vanchor: null });
  }
  runCmd(raw) {
    const c = raw.trim(), [head, ...rest] = c.split(/\s+/), arg = rest.join(' '), s = this.state, v = s.view;
    const set = o => this.setState({ mode: 'normal', cmd: '', ...o });
    if (!c) return set({});
    if (s.long) {
      const dirty = s.longText !== s.long.saved;
      if (head === 'w') { const ok = this.writeLong(); return set({ msg: ok ? 'written' : 'nothing to write (empty)' }); }
      if (head === 'wq' || head === 'x') { set({}); return this.commitLong(); }
      if (head === 'q' || head === 'quit') { if (dirty) return set({ msg: 'no write since last change · :wq writes · :q! discards' }); set({}); return this.closeLong(); }
      if (head === 'q!' || head === 'quit!') { set({}); return this.closeLong(); }
      if (head === 'page' && s.long.kind === 'quote' && !s.long.isNew) { const n = parseInt(arg, 10); this.mutate(bs => { bs.find(b => b.id === s.long.bookId).quotes.find(q => q.id === s.long.id).page = isNaN(n) ? null : n; }); return set({ msg: isNaN(n) ? 'page cleared' : `p. ${n}` }); }
      if (!['theme', 'colorscheme', 'set', 'help', 'h'].includes(head)) return set({ msg: 'while editing: :w :wq :q :q!' });
    }
    if (head === 'q' || head === 'quit') { set({}); return this.back(); }
    if (head === 'new') { const [what, ...t] = rest; const title = t.join(' '); if (what === 'book') { if (!title) { set({}); return this.startBook(); } this.writeBuf({ kind: 'book', isNew: true }, title); return set({ cur: s.books.length, msg: `"${title}" created` }); } if (what === 'thought' && v.type === 'thread') { set({}); return this.startNew('thought'); } return set({ msg: 'usage: :new book <title>' }); }
    if (head === 'quote') { if (v.type !== 'book') return set({ msg: 'open a book first' }); const sw = { view: { type: 'book', bookId: v.bookId, sec: 'quotes' }, ...this.sidePos(v.bookId, 'quotes') }; if (!arg) { set(sw); return this.startNew('quote'); } this.writeBuf({ kind: 'quote', isNew: true, bookId: v.bookId }, arg); return set({ ...sw, cur: this.book().quotes.length, msg: 'quote added · :page <n> to set page' }); }
    if (head === 'def') { if (v.type !== 'book') return set({ msg: 'open a book first' }); set({ view: { type: 'book', bookId: v.bookId, sec: 'vocab' }, ...this.sidePos(v.bookId, 'vocab') }); return this.startNew('vocab', arg ? arg + '\n' : '', 'insert'); }
    if (head === 'page') { const n = parseInt(arg, 10); const it = this.items()[s.cur]; if (v.type === 'thread' || (it && it.kind === 'quote')) { this.mutate(bs => { const q = bs.find(b => b.id === v.bookId).quotes.find(q => q.id === (v.quoteId || it.q.id)); q.page = isNaN(n) ? null : n; }); return set({ msg: isNaN(n) ? 'page cleared' : `p. ${n}` }); } return set({ msg: 'no quote under cursor' }); }
    if (head === 'tag') { const b = this.book() || (this.items()[s.cur] || {}).b; if (!b) return set({ msg: 'no book' }); if (!arg) return set({ msg: 'usage: :tag #name' }); const t = '#' + norm(arg); this.mutate(bs => { const bb = bs.find(x => x.id === b.id); bb.tags.includes(t) ? bb.tags.splice(bb.tags.indexOf(t), 1) : bb.tags.push(t); }); return set({ msg: `${t} toggled on ${b.slug}` }); }
    if (head === 'tags' || head === 'go') { if (!arg) return set({ msg: 'usage: :go #name' }); set({}); return this.openTag(arg); }
    if (head === 'author') { const b = this.book() || (this.items()[s.cur] || {}).b; if (!b) return set({ msg: 'no book' }); this.mutate(bs => { bs.find(x => x.id === b.id).author = arg; }); return set({ msg: `author: ${arg}` }); }
    if (head === 'theme' || head === 'colorscheme') { const t = THEMES[arg] ? arg : s.theme === 'light' ? 'dark' : 'light'; return set({ theme: t, msg: `theme ${t}` }); }
    if (head === 'set') { if (arg === 'nu' || arg === 'nonu' || arg === 'nu!') return set({ nu: !s.nu }); if (arg === 'bg=dark' || arg === 'bg=light') return set({ theme: arg.slice(3) }); return set({ msg: `unknown option: ${arg}` }); }
    if (head === 'help' || head === 'h') return set({ help: !s.help });
    if (head === 'w' || head === 'wq') { if (head === 'wq') this.back(); if (!s.archive) return set({ msg: 'written (localStorage only · no archive)' }); set({}); return this.saveArchive().then(ok => ok && this.setState({ msg: `written to ${s.archive}` })); }
    if (head === 'reload' || head === 'e!') { if (!s.archive) return set({ msg: 'no archive' }); set({}); return this.loadArchive(true); }
    if (head === 'reset') { this.undo.push(JSON.stringify(s.books)); return set({ books: seed(), view: { type: 'library' }, cur: 0, side: 0, expanded: {}, msg: 'everything cleared · u to undo' }); }
    if (head === 'e' || head === 'files') return set({ sidebar: true, focus: 'side' });
    if (head === 'vocab' || head === 'words') { set({}); return this.goView({ type: 'vocab' }); }
    if (head === 'git') { set({}); const args = commitMsg(splitArgs(arg), arg); if (!args.length) return this.setState({ msg: ':git <args> · e.g. :git status' }); return this.runGit(args); }
    if (head === 'commit') { set({}); return this.gitCommit(arg); }
    if (head === 'push' || head === 'pull' || head === 'status' || head === 'log') { set({}); return this.runGit(head === 'log' ? ['log', '--oneline', '-n', '20', ...splitArgs(arg)] : head === 'status' ? ['status', '--short', '--branch', ...splitArgs(arg)] : [head, ...splitArgs(arg)]); }
    if (head === 'ai' || head === 'lookup') { if (v.type === 'word') { set({}); return this.loadAI(true); } const it = this.items()[s.cur]; if (it && it.kind === 'vocab') { set({}); return this.openWord(it.b.id, it.w.id); } return set({ msg: 'put the cursor on a word first' }); }
    set({ msg: `not a command: ${head}` });
  }
  // ---- clipboard
  itemText(it) { return it ? (it.kind === 'ref' ? it.r.text : it.kind === 'vocab' ? `${it.w.word} — ${it.w.def}` : it.kind === 'book' ? it.b.title : it.kind === 'quote' ? it.q.text : it.t.text) : ''; }
  yankRange(a, b) {
    const its = this.items().slice(Math.min(a, b), Math.max(a, b) + 1);
    return its.map(it => this.itemText(it)).join('\n');
  }
  copy(e) {
    const s = this.state;
    if (s.long || s.focus === 'side' || s.mode === 'command' || s.mode === 'search') return;
    if (String(window.getSelection && window.getSelection()).length) return;
    const vis = s.mode === 'visual' && s.vanchor !== null;
    const a = vis ? s.vanchor : s.cur, b = s.cur, txt = this.yankRange(a, b);
    if (!txt) return;
    e.clipboardData.setData('text/plain', txt); e.preventDefault();
    const n = Math.abs(b - a) + 1;
    this.setState({ mode: 'normal', vanchor: null, msg: `${n} ${n === 1 ? 'line' : 'lines'} yanked` });
  }
  paste(e) {
    const s = this.state, L = s.long;
    if (L && L.vmode === 'insert' && s.mode !== 'command') return;   // native paste into the textarea
    const raw = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!raw) return;
    e.preventDefault();
    if (L && s.mode !== 'command') return this.longPaste(raw.replace(/\r\n/g, '\n'), true);
    this.pasteText(raw);
  }
  // in the lists, a paste becomes a new item opened in the buffer (normal mode) so it can be checked before :wq
  pasteText(raw) {
    const s = this.state, flat = raw.replace(/\r?\n+/g, ' '), text = raw.replace(/\r\n/g, '\n').trim();
    if (s.mode === 'command') { const c = Math.min(s.cmdc, s.cmd.length); return this.setState({ cmd: s.cmd.slice(0, c) + flat + s.cmd.slice(c), cmdc: c + flat.length }); }
    if (s.mode === 'search') { const cmd = s.cmd + flat; return this.setState({ cmd, filter: cmd, cur: 0 }); }
    if (s.mode === 'fields') { const f = s.fields, p = Math.min(f.pos, f.text.length); return this.fieldsSet(f.text.slice(0, p) + flat + f.text.slice(p), p + flat.length); }
    if (!text || s.focus === 'side') return;
    const v = s.view, kind = v.type === 'library' ? 'book' : v.type === 'book' ? (v.sec === 'vocab' ? 'vocab' : 'quote') : v.type === 'thread' ? 'thought' : null;
    if (kind) this.startNew(kind, kind === 'book' ? flat.trim() : text, 'normal');
  }
  // ---- tag completion ([ in insert mode)
  // what is being completed at the caret: `[query` (tag = the words) or `[some words](query` (tag named separately)
  tagQuery() {
    const L = this.state.long; if (!L || L.vmode !== 'insert' || L.tagPopClosed || this.state.mode === 'command') return null;
    const t = this.state.longText.slice(0, L.caret);
    let m = /\[[^\[\]\n]+\]\(([^()\n]*)$/.exec(t); if (m) return { q: m[1], close: ')', start: t.length - m[1].length };
    m = /\[([^\[\]\n]*)$/.exec(t); if (m) return { q: m[1], close: ']', start: t.length - m[1].length };
    return null;
  }
  tagOptions(q) {
    const all = [...this.tagIndex().keys()].sort(), ql = norm(q);
    const list = all.filter(n => n.includes(ql)).map(n => ({ name: n, create: false }));
    if (ql && !all.includes(ql)) list.push({ name: ql, create: true });
    return list.slice(0, 8);
  }
  acceptTag(opt) {
    const s = this.state, L = s.long, t = s.longText, p = Math.min(L.caret, t.length), tq = this.tagQuery();
    if (!tq || !opt) return;
    this.setC(tq.start + opt.name.length + 1, { vmode: 'insert', tagSel: 0, tagPopClosed: false }, t.slice(0, tq.start) + opt.name + tq.close + t.slice(p));
  }
  // ---- hover popup
  showHover(tag, el) {
    clearTimeout(this.ht);
    const r = el.getBoundingClientRect(), flip = r.bottom > window.innerHeight - 240;
    this.setState({ hover: { tag: norm(tag), x: Math.min(r.left, window.innerWidth - 440), y: flip ? null : r.bottom + 4, bottom: flip ? window.innerHeight - r.top + 4 : null } });
  }
  hideHover() { clearTimeout(this.ht); this.ht = setTimeout(() => this.setState({ hover: null }), 180); }
  keepHover() { clearTimeout(this.ht); }
  // ---- keys
  key(e) {
    const s = this.state, L = s.long, editing = L && s.mode !== 'command';   // keys go to the buffer
    if (e.metaKey && e.code === 'Space') { e.preventDefault(); this.pending(' '); return; }
    if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'h' || e.key === 'l') && !L && s.mode !== 'command' && s.mode !== 'search' && s.mode !== 'fields') { e.preventDefault(); return this.focusPane(e.key === 'h' ? 'side' : 'main'); }
    const tq = this.tagQuery(), opts = tq !== null ? this.tagOptions(tq.q) : [];
    if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'n' || e.key === 'p') && opts.length) { e.preventDefault(); return this.setState({ long: { ...L, tagSel: (L.tagSel + (e.key === 'n' ? 1 : opts.length - 1)) % opts.length } }); }
    if (editing && e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'r' && L.vmode !== 'insert') { e.preventDefault(); return this.longRedo(); }
    if ((e.metaKey || e.ctrlKey || e.altKey) && !(e.metaKey && e.ctrlKey)) {
      if ((s.mode === 'command' || s.mode === 'search') && this.cmdShortcut(e)) return;
      if (s.mode === 'fields' && this.fieldsShortcut(e)) return;
      if (editing && L.vmode === 'insert' && this.longChop(e)) return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (editing) return this.longKey(e);
    const k = e.key;
    if (k === 'Shift' || k === 'CapsLock') return;
    if (k === 'Tab' && s.mode !== 'command') return;
    e.preventDefault();
    if (s.mode === 'fields') return this.fieldsKey(k);
    if (s.mode === 'command' || s.mode === 'search') {
      const isCmd = s.mode === 'command', c = Math.min(s.cmdc, s.cmd.length);
      const put = (cmd, cmdc) => this.setState({ cmd, cmdc, filter: isCmd ? s.filter : cmd, cur: isCmd ? s.cur : 0 });
      if (k === 'Escape') return this.setState({ mode: 'normal', cmd: '', filter: isCmd ? s.filter : s.search });
      if (k === 'Enter') { if (isCmd) { this.remember(s.cmd); return this.runCmd(s.cmd); } return this.setState({ mode: 'normal', search: s.filter, cmd: '', msg: this.items().length + ' match' + (this.items().length === 1 ? '' : 'es') + (s.filter ? ' · Esc clears' : '') }); }
      if (k === 'Backspace') { if (!s.cmd) return this.setState({ mode: 'normal', filter: isCmd ? s.filter : s.search }); if (!c) return; return put(s.cmd.slice(0, c - 1) + s.cmd.slice(c), c - 1); }
      if (k === 'Delete') return put(s.cmd.slice(0, c) + s.cmd.slice(c + 1), c);
      if (k === 'ArrowLeft') return this.setState({ cmdc: Math.max(0, c - 1) });
      if (k === 'ArrowRight') return this.setState({ cmdc: Math.min(s.cmd.length, c + 1) });
      if (k === 'Home') return this.setState({ cmdc: 0 });
      if (k === 'End') return this.setState({ cmdc: s.cmd.length });
      if (isCmd && (k === 'ArrowUp' || k === 'ArrowDown')) return this.histMove(k === 'ArrowUp' ? -1 : 1);
      if (k === 'Tab' && isCmd) { const m = CMDS.find(x => x[0].startsWith(s.cmd)); if (m) { const cmd = m[0].replace(/<.*>/, '').trimEnd() + (m[0].includes('<') ? ' ' : ''); put(cmd, cmd.length); } return; }
      if (k.length === 1) return put(s.cmd.slice(0, c) + k + s.cmd.slice(c), c + 1);
      return;
    }
    // normal / visual
    if (k === 'Escape') return this.setState({ mode: 'normal', vanchor: null, pending: '', count: '', msg: '', help: false, filter: '', search: '', hover: null });
    if (/^[1-9]$/.test(k) || (k === '0' && s.count)) return this.setState({ count: s.count + k });
    this.pending(k);
  }
  // command-line history: Up / Down walk it, the line being typed is kept as a draft at the bottom
  remember(cmd) { const c = cmd.trim(); if (!c) return; if (this.hist[this.hist.length - 1] !== c) this.hist = [...this.hist, c].slice(-100); try { localStorage.setItem('notes.hist.v1', JSON.stringify(this.hist)); } catch (e) {} }
  histMove(d) {
    const s = this.state, h = this.hist, at = s.histIdx === null ? h.length : s.histIdx, to = Math.max(0, Math.min(h.length, at + d));
    if (to === at) return;
    const cmd = to === h.length ? s.histDraft : h[to];
    this.setState({ cmd, cmdc: cmd.length, histIdx: to === h.length ? null : to, histDraft: at === h.length ? s.cmd : s.histDraft });
  }
  // word / line shortcuts for a one-line field, relative to the cursor: ⌥← ⌥→ ⌘← ⌘→ Ctrl-a Ctrl-e move · ⌥⌫ Ctrl-w ⌘⌫ Ctrl-u Ctrl-k delete.
  // Returns the new { text, pos }, or null if the key is not one of these.
  lineShortcut(e, t, c) {
    const k = e.key, alt = e.altKey && !e.metaKey && !e.ctrlKey, meta = e.metaKey && !e.altKey, ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
    const wordBack = () => { let a = c; while (a > 0 && /\s/.test(t[a - 1])) a--; while (a > 0 && !/\s/.test(t[a - 1])) a--; return a; }, wordFwd = () => { let b = c; while (b < t.length && /\s/.test(t[b])) b++; while (b < t.length && !/\s/.test(t[b])) b++; return b; };
    let text = t, pos = c;
    if (alt && k === 'ArrowLeft') pos = wordBack();
    else if (alt && k === 'ArrowRight') pos = wordFwd();
    else if ((meta && k === 'ArrowLeft') || (ctrl && k === 'a')) pos = 0;
    else if ((meta && k === 'ArrowRight') || (ctrl && k === 'e')) pos = t.length;
    else if ((alt && k === 'Backspace') || (ctrl && k === 'w')) { const a = wordBack(); text = t.slice(0, a) + t.slice(c); pos = a; }
    else if ((meta && k === 'Backspace') || (ctrl && k === 'u')) { text = t.slice(c); pos = 0; }
    else if (ctrl && k === 'k') text = t.slice(0, c);
    else return null;
    return { text, pos };
  }
  cmdShortcut(e) {
    const s = this.state, isCmd = s.mode === 'command', r = this.lineShortcut(e, s.cmd, Math.min(s.cmdc, s.cmd.length)); if (!r) return false;
    e.preventDefault(); this.setState({ cmd: r.text, cmdc: r.pos, filter: isCmd ? s.filter : r.text, cur: isCmd ? s.cur : 0 }); return true;
  }
  // vim's Ctrl-w / Ctrl-u inside the long-form textarea (mac option/cmd shortcuts are native there)
  longChop(e) {
    const k = e.key, el = this.longEl(); if (!el || !e.ctrlKey || e.metaKey || e.altKey || (k !== 'w' && k !== 'u')) return false;
    const t = el.value, c = el.selectionStart; let a = c;
    if (k === 'u') a = t.lastIndexOf('\n', c - 1) + 1;
    else { while (a > 0 && /\s/.test(t[a - 1]) && t[a - 1] !== '\n') a--; while (a > 0 && /\S/.test(t[a - 1])) a--; }
    if (a === c) return true;
    e.preventDefault(); this.setState({ longText: t.slice(0, a) + t.slice(c) }, () => this.longCaret(a)); return true;
  }
  pending(k) {
    const s = this.state, p = s.pending + k, seqs = ['dd', 'gg', 'gx', 'yy', '\\b', ' ee'];
    clearTimeout(this.pt);
    if (seqs.includes(p)) { this.setState({ pending: '', count: '' }); return this.seq(p); }
    if (seqs.some(q => q.startsWith(p))) { this.setState({ pending: p }); this.pt = setTimeout(() => this.setState({ pending: '' }), 900); return; }
    this.setState({ pending: '' });
    if (s.pending) return;
    this.single(k);
  }
  seq(p) {
    const s = this.state;
    if (p === 'dd') return s.focus === 'side' ? this.setState({ msg: 'delete from the library, not the tree' }) : this.deleteRange(s.cur, s.cur);
    if (p === 'gg') return this.setState(s.focus === 'side' ? { side: 0 } : { cur: 0 });
    if (p === 'gx') { if (s.focus === 'side') return; const t = tagsOf(this.itemText(this.items()[s.cur]))[0]; return t ? this.openTag(t) : this.setState({ msg: 'no [link] on this line' }); }
    if (p === 'yy') { if (s.focus === 'side') return; const txt = this.yankRange(s.cur, s.cur); if (!txt) return; try { navigator.clipboard.writeText(txt); } catch (e) {} return this.setState({ msg: '1 line yanked' }); }
    if (p === '\\b' || p === ' ee') return this.setState({ sidebar: !s.sidebar, focus: !s.sidebar ? 'side' : 'main' });
  }
  single(k) {
    const s = this.state, n = this.items().length, c = parseInt(s.count || '1', 10), side = s.focus === 'side';
    const move = d => side ? this.setState({ side: this.clamp(s.side + d, this.sideList().length), count: '' }) : this.setState({ cur: this.clamp(s.cur + d, n), count: '' });
    switch (k) {
      case 'j': case 'ArrowDown': return move(c);
      case 'k': case 'ArrowUp': return move(-c);
      case 'G': return this.setState(side ? { side: this.sideList().length - 1 } : { cur: n - 1, count: '' });
      case 'h': case 'ArrowLeft': if (side) return this.sideUp(); return this.back();
      case 'l': case 'ArrowRight': return this.open(true);
      case 'Enter': return this.open();
      case 'i': case 'c': if (side) return; return this.startEdit('normal');
      case 'I': if (side) return; return this.startEdit('start');
      case 'a': if (side) return; return s.view.type === 'thread' ? this.newThought(true) : this.startEdit('end');
      case 'A': if (side) return; return this.startEdit('end');
      case 'o': case 'O': if (side) return; return this.newHere();
      case 'v': case 'V': if (side || !n) return; return this.setState({ mode: s.mode === 'visual' ? 'normal' : 'visual', vanchor: s.mode === 'visual' ? null : s.cur });
      case 'd': case 'x': if (s.mode === 'visual') return this.deleteRange(s.vanchor, s.cur); return;
      case 'y': if (s.mode === 'visual') { const a = Math.min(s.vanchor, s.cur), b = Math.max(s.vanchor, s.cur); try { navigator.clipboard.writeText(this.yankRange(a, b)); } catch (e) {} return this.setState({ mode: 'normal', vanchor: null, msg: `${b - a + 1} lines yanked` }); } return;
      case 'p': case 'P': { if (side) return; if (!navigator.clipboard || !navigator.clipboard.readText) return this.setState({ msg: 'clipboard unavailable · use ⌘v' }); navigator.clipboard.readText().then(t => this.pasteText(t)).catch(() => this.setState({ msg: 'clipboard unavailable · use ⌘v' })); return; }
      case 'r': if (s.view.type === 'word') return this.loadAI(true); return;
      case 'u': return this.undoOnce();
      case ':': return this.setState({ mode: 'command', cmd: '', cmdc: 0, histIdx: null, msg: '', help: false });
      case '/': return this.setState({ mode: 'search', cmd: '', cmdc: 0, filter: '', msg: '', cur: 0 });
      case '?': return this.setState({ help: !s.help });
      case 'n': return this.setState({ msg: s.search ? `filtered by /${s.search}` : 'no previous search' });
      case 'q': return this.back();
    }
  }
  itemsFor(books) { const b = this.state.books; this.state.books = books; const r = this.items(); this.state.books = b; return r; }
  // ---- mouse
  clickRow(i) { if (this.state.mode === 'fields') this.fieldsDone();
    const s = this.state; if (i === undefined) return;
    this.setState({ cur: i, focus: 'main', mode: s.mode === 'visual' ? 'visual' : 'normal', hover: null, msg: s.mode === 'visual' ? s.msg : '' });
  }
  dblRow(i) { if (i === undefined) return; this.settle(); this.setState({ cur: i, focus: 'main', hover: null }, () => this.open(false)); }
  clickSide(i) {
    const s = this.state, n = this.sideList()[i]; if (!n) return; this.settle();
    if (n.kind === 'book') return this.setState({ side: i, focus: 'side', expanded: { ...s.expanded, [n.b.id]: !s.expanded[n.b.id] }, msg: '', hover: null });
    if (n.kind === 'all') return this.setState({ side: i, focus: 'side', view: { type: 'vocab' }, cur: 0, filter: '', msg: '', hover: null });
    this.setState({ side: i, focus: 'side', view: { type: 'book', bookId: n.b.id, sec: n.sec }, cur: 0, filter: '', msg: '', hover: null });
  }
  action(name) {
    const s = this.state;
    switch (name) {
      case 'new': this.settle(); return this.newHere();
      case 'edit': this.settle(); return s.focus === 'side' ? this.setState({ msg: 'select a line in the main pane' }) : this.startEdit('normal');
      case 'delete': this.settle(); return s.focus === 'side' ? this.setState({ msg: 'delete from the library, not the tree' }) : this.deleteRange(s.mode === 'visual' ? s.vanchor : s.cur, s.cur);
      case 'undo': this.settle(); return this.undoOnce();
      case 'cmd': this.settle(); return this.setState({ mode: 'command', cmd: '', cmdc: 0, histIdx: null, msg: '', help: false });
      case 'help': return this.setState({ help: !s.help });
      case 'theme': return this.setState({ theme: s.theme === 'light' ? 'dark' : 'light' });
      case 'sidebar': return this.setState({ sidebar: !s.sidebar, focus: s.sidebar && s.focus === 'side' ? 'main' : s.focus });
      case 'done': return this.settle();
      case 'run': return this.runCmd(s.cmd);
      case 'apply': return this.setState({ mode: 'normal', search: s.filter, cmd: '' });
      case 'cancel': return this.setState({ mode: 'normal', cmd: '', fields: null, filter: s.mode === 'search' ? s.search : s.filter, vanchor: null });
      case 'clear': return this.setState({ filter: '', search: '', msg: '' });
      case 'yank': { const a = Math.min(s.vanchor, s.cur), b = Math.max(s.vanchor, s.cur); try { navigator.clipboard.writeText(this.yankRange(a, b)); } catch (e) {} return this.setState({ mode: 'normal', vanchor: null, msg: `${b - a + 1} lines yanked` }); }
      case 'keep': return this.commitLong();
      case 'write': { const ok = this.writeLong(); return this.setState({ msg: ok ? 'written' : 'nothing to write (empty)' }); }
      case 'close': return this.runCmd('q');
    }
  }
  clickComp(cp) { if (cp.arg) return this.setState({ cmd: cp.prefix, cmdc: cp.prefix.length }); this.runCmd(cp.prefix); }
  // ---- rich text: [tag] links
  rich(text) {
    const str = String(text ?? ''), parts = []; let last = 0, m; const re = new RegExp(LINK_RE.source, 'g');
    while ((m = re.exec(str))) {
      if (m.index > last) parts.push(str.slice(last, m.index));
      const name = norm(m[2] || m[1]);
      parts.push(<span key={m.index} className="link" onMouseEnter={e => this.showHover(name, e.currentTarget)} onMouseLeave={() => this.hideHover()} onClick={e => { e.stopPropagation(); this.openTag(name); }}>[{m[1]}]{m[2] ? <span className="link-tag">#{name}</span> : null}</span>);
      last = m.index + m[0].length;
    }
    if (last < str.length) parts.push(str.slice(last));
    return parts.length ? parts : str;
  }
  // the buffer backdrop: the text with [tagged spans] and their (names) wrapped, so they can be highlighted under the textarea
  bufMarks(text, L) {
    const str = text + ' ', cuts = new Set([0, str.length]), links = [], re = new RegExp(LINK_RE.source, 'g'); let m;
    while ((m = re.exec(str))) { const l = { s: m.index, e: m.index + m[0].length, lab: m.index + m[1].length + 2 }; links.push(l); cuts.add(l.s); cuts.add(l.lab); cuts.add(l.e); }
    const ins = !L || L.vmode === 'insert', cur = ins ? (L ? [L.caret, L.caret + 1] : null) : [L.c, L.c + 1], sel = !ins && L.vmode !== 'normal' ? this.selRange(L, text) : null;
    if (cur) { cuts.add(cur[0]); cuts.add(cur[1]); } if (sel) { cuts.add(sel[0]); cuts.add(sel[1]); }
    const at = L ? (ins ? L.caret : L.c) : -1, hov = L && L.hover != null ? L.hover : -1, pts = [...cuts].sort((a, b) => a - b), parts = [];
    const seg = (p, q) => {   // one run of text with its cursor / selection state
      const cls = []; if (sel && p >= sel[0] && q <= sel[1]) cls.push('sel'); if (cur && p >= cur[0] && q <= cur[1]) cls.push(ins ? 'ic' : 'cur');
      const piece = str.slice(p, q);
      if (cls.includes('cur') && piece === '\n') return [<span key={p} className="cur"> </span>, '\n'];   // a block on an empty line
      return cls.length ? <span key={p} className={cls.join(' ')}>{piece}</span> : piece;
    };
    for (let k = 0; k + 1 < pts.length;) {
      const p = pts[k], lk = links.find(l => l.s === p);
      if (!lk) { parts.push(seg(p, pts[k + 1])); k++; continue; }
      // a link: the [label] inline, the (tag) as a small label floated above it (shown when the cursor or the mouse is on it)
      const on = (at >= lk.s && at < lk.e) || (hov >= lk.s && hov < lk.e), lab = [], tag = [];
      while (pts[k] < lk.lab) { lab.push(seg(pts[k], pts[k + 1])); k++; }
      while (pts[k] < lk.e) { tag.push(seg(pts[k], pts[k + 1])); k++; }
      parts.push(<span key={p} className={on ? 'lw on' : 'lw'}><span className="bl">{lab}</span>{tag.length ? <span className="bt">{tag}</span> : null}</span>);
    }
    return parts;
  }
  // mouse over the buffer: which character is under the pointer (for showing a span's tag name)
  hoverBuf(e) {
    const L = this.state.long; if (!L) return;
    const i = e ? this.idxAt(e.clientX, e.clientY) : null, t = this.state.longText, re = new RegExp(LINK_RE.source, 'g'); let m, hit = null;
    if (i != null) while ((m = re.exec(t))) if (i >= m.index && i < m.index + m[0].length) { hit = m.index; break; }
    const cur = L.hover != null ? this.linkStart(t, L.hover) : null;
    if (hit !== cur) this.setState({ long: { ...L, hover: hit } });
  }
  linkStart(t, i) { const re = new RegExp(LINK_RE.source, 'g'); let m; while ((m = re.exec(t))) if (i >= m.index && i < m.index + m[0].length) return m.index; return null; }
  // ---- render
  renderVals() {
    const s = this.state, th = THEMES[s.theme], v = s.view, items = this.items(), b = this.book(), q = this.quote(), idx = this.tagIndex();
    const inVis = (i) => s.mode === 'visual' && s.vanchor !== null && i >= Math.min(s.vanchor, s.cur) && i <= Math.max(s.vanchor, s.cur);
    const num = i => !s.nu ? '' : i === s.cur ? String(i + 1) : String(Math.abs(i - s.cur));
    const row = (i, o) => { const sel = i === s.cur && s.focus === 'main'; return { isRow: true, isHeader: false, idx: i, cur: sel, num: num(i), numColor: sel ? 'var(--ink,#111)' : 'var(--faint,#b5b2aa)', bg: sel || inVis(i) ? 'var(--hl,#f3f1ec)' : 'transparent', weight: sel ? 500 : 400, mainColor: 'var(--ink,#111)', pre: '', sub: '', a: '', b: '', c: '', d: '', ...o }; };
    const header = (pre, main, a = '', bb = '', c = '', d = '') => ({ isHeader: true, isRow: false, pre, main, a, b: bb, c, d });
    const note = main => ({ isRow: true, isHeader: false, num: '', numColor: 'var(--faint)', bg: 'transparent', weight: 400, mainColor: 'var(--muted,#8a877f)', pre: '', main, sub: '', a: '', b: '', c: '', d: '' });
    let lines = [], summary = '', statusPath = 'library', quote = null, word = null;
    let crumbs = [{ label: '~/notes', go: () => this.goView({ type: 'library' }) }];
    if (v.type === 'empty') { crumbs = []; statusPath = '[No Name]'; }
    else if (v.type === 'library') {
      lines.push(header('', 'TITLE', 'QUOTES', 'VOCAB', 'TAGS', 'TOUCHED'));
      items.forEach((it, i) => { const bk = it.b, t = touched(bk); lines.push(row(i, { id: bk.id, main: bk.title, sub: bk.author ? '— ' + bk.author : '', a: String(bk.quotes.length), b: String(bk.vocab.length), c: bk.tags.join(' '), d: t ? fmtDay(t) : '—' })); });
      if (s.mode === 'fields') { const f = s.fields, onTitle = f.step === 'title'; lines.push({ isRow: true, isHeader: false, num: '', numColor: 'var(--faint)', bg: 'var(--hl,#f3f1ec)', weight: 400, mainColor: 'var(--ink,#111)', pre: '', main: '', sub: '', a: '', b: '', c: '', d: '', pos: Math.min(f.pos, f.text.length), fields: [{ text: onTitle ? f.text : f.title, ph: 'title', active: onTitle }, { text: onTitle ? '' : f.text, ph: 'author', active: !onTitle }] }); }
      else if (!items.length) lines.push(note(s.filter ? 'no books match' : 'no books yet — o or :new book <title>'));
      const nq = s.books.reduce((n, x) => n + x.quotes.length, 0), nv = s.books.reduce((n, x) => n + x.vocab.length, 0);
      summary = `${s.books.length} books · ${nq} quotes · ${nv} words`;
    } else if (v.type === 'book' && b) {
      const sec = v.sec === 'vocab' ? 'vocab' : 'quotes';
      crumbs.push({ label: '/' + b.slug, go: () => this.goView({ type: 'book', bookId: b.id, sec: 'quotes' }) });
      crumbs.push({ label: '/' + sec, go: () => this.goView({ type: 'book', bookId: b.id, sec }) });
      statusPath = `library › ${b.slug} › ${sec}`; summary = [b.author, ...b.tags].filter(Boolean).join(' · ');
      if (sec === 'quotes') {
        lines.push(header('', 'QUOTES', 'PAGE', 'THOUGHTS'));
        items.forEach((it, i) => lines.push(row(i, { id: it.q.id, pre: qn(b, it.q), main: '“' + it.q.text + '”', a: it.q.page ? 'p. ' + it.q.page : '', b: countThoughts(it.q) ? String(countThoughts(it.q)) : '·' })));
        if (!items.length) lines.push(note('no quotes yet — o to add one'));
      } else {
        lines.push(header('', 'VOCAB', '', '', '', 'ADDED'));
        items.forEach((it, i) => lines.push(row(i, { id: it.w.id, pre: it.w.word, main: it.w.def, d: fmtDay(it.w.at) })));
        if (!items.length) lines.push(note('no words yet — o to add one'));
      }
    } else if (v.type === 'thread' && b && q) {
      crumbs.push({ label: '/' + b.slug, go: () => this.goView({ type: 'book', bookId: b.id, sec: 'quotes' }) });
      crumbs.push({ label: '/quotes', go: () => this.goView({ type: 'book', bookId: b.id, sec: 'quotes' }, b.quotes.indexOf(q)) });
      crumbs.push({ label: '/' + qn(b, q), go: () => {} });
      statusPath = `library › ${b.slug} › ${qn(b, q)}`; summary = `${b.title}${b.author ? ' · ' + b.author : ''}`;
      const nt = countThoughts(q); quote = { text: q.text, ref: `${b.slug}/${qn(b, q)}`, page: q.page ? 'p. ' + q.page : 'no page · :page <n>', count: `${nt} ${nt === 1 ? 'thought' : 'thoughts'}` };
      items.forEach((it, i) => lines.push(row(i, { id: it.t.id, pre: fmtTime(it.t.at), main: it.t.text, indent: it.depth })));
      if (!items.length) lines.push(note('no thoughts yet — o to write one · a on a thought replies to it'));
    } else if (v.type === 'vocab') {
      crumbs.push({ label: '/vocab', go: () => this.goView({ type: 'vocab' }) });
      statusPath = 'vocab › all books'; summary = `${items.length} ${items.length === 1 ? 'word' : 'words'} · ${s.books.filter(bk => bk.vocab.length).length} books`;
      lines.push(header('', 'VOCAB', 'BOOK', '', 'TAGS', 'ADDED'));
      items.forEach((it, i) => lines.push(row(i, { id: it.w.id, pre: it.w.word, main: it.w.def, a: it.b.slug, c: it.b.tags.join(' '), d: fmtDay(it.w.at) })));
      if (!items.length) lines.push(note(s.filter ? 'no words match' : 'no words yet — :def <word> inside a book'));
    } else if (v.type === 'word' && b) {
      const w = this.word();
      crumbs.push({ label: '/' + b.slug, go: () => this.goView({ type: 'book', bookId: b.id, sec: 'quotes' }) });
      crumbs.push({ label: '/vocab', go: () => this.goView({ type: 'book', bookId: b.id, sec: 'vocab' }, w ? b.vocab.indexOf(w) : 0) });
      crumbs.push({ label: '/' + (w ? w.word : '?'), go: () => {} });
      statusPath = `vocab › ${b.slug} › ${w ? w.word : '?'}`; summary = [b.title, b.author, ...b.tags].filter(Boolean).join(' · ');
      if (w) {
        const ai = w.ai || {}, busy = s.aiBusy === w.id;
        const sections = FIELDS.filter(([k]) => k !== 'pos' && k !== 'ipa').map(([k, label]) => ({ label, text: k === 'synonyms' ? (ai.synonyms || []).join(', ') : ai[k] || '' })).filter(x => x.text);
        word = { word: w.word, meta: [ai.pos, ai.ipa].filter(Boolean).join(' · '), note: w.def, where: `${b.slug} · added ${fmtDay(w.at)}`, sections, busy,
          foot: busy ? 'asking openai…' : w.ai ? `${w.ai.model} · r to ask again` : hasKey() ? 'nothing yet · r to ask' : 'add VITE_OPENAI_API_KEY to .env to fill this in' };
      }
    } else if (v.type === 'tag') {
      const e = idx.get(v.tag);
      crumbs.push({ label: '/#' + v.tag, go: () => {} });
      statusPath = `tag › #${v.tag}`; summary = `${items.length} ${items.length === 1 ? 'place' : 'places'}`;
      lines.push(header('', 'WHERE', 'TEXT', 'KIND'));
      items.forEach((it, i) => lines.push(row(i, { id: it.r.id, pre: it.r.label, main: it.r.text, a: it.r.kind })));
      if (!e || !items.length) lines.push(note(`nothing tagged [${v.tag}] yet — write [${v.tag}] inside any line`));
    }
    const sideItems = this.sideList().map((n, i) => {
      const foc = s.focus === 'side' && i === s.side, bg = foc ? 'var(--hl,#f3f1ec)' : 'transparent';
      if (n.kind === 'all') return { i, group: 'all', sub: false, label: 'all words', counts: String(s.books.reduce((k, bk) => k + bk.vocab.length, 0)), bg, weight: v.type === 'vocab' || foc ? 500 : 400 };
      if (n.kind === 'book') return { i, group: 'books', sub: false, label: (s.expanded[n.b.id] ? '▾ ' : '▸ ') + n.b.slug, counts: `${n.b.quotes.length}q ${n.b.vocab.length}v`, bg, weight: v.bookId === n.b.id || foc ? 500 : 400 };
      const on = v.bookId === n.b.id && (v.type === 'thread' ? n.sec === 'quotes' : v.type === 'book' && (v.sec || 'quotes') === n.sec);
      return { i, group: 'books', sub: true, label: n.sec, counts: String(n.b[n.sec].length), bg, weight: on || foc ? 500 : 400 };
    });
    const tags = [...idx.values()].sort((x, y) => y.refs.length - x.refs.length || x.name.localeCompare(y.name)).map(e => ({ name: e.name, n: e.refs.length, on: v.type === 'tag' && v.tag === e.name }));
    const L = s.long, lb = L && s.books.find(x => x.id === L.bookId), lq = lb && L.quoteId && lb.quotes.find(x => x.id === L.quoteId);
    const bufTitle = L ? `${L.isNew ? 'new ' : ''}${L.kind === 'vocab' ? 'word' : L.kind}${lb ? ' · ' + lb.slug + (lq ? '/' + qn(lb, lq) : '') : ''}` : '';
    const bufHint = L ? (L.kind === 'book' ? 'line 1 title · line 2 author' : L.kind === 'vocab' ? 'line 1 word · definition below' : '[word] links a tag') : '';
    const modeLabel = s.mode === 'fields' ? 'INSERT' : s.mode === 'command' ? 'COMMAND' : L ? VMODES[L.vmode] : s.mode === 'search' ? 'SEARCH' : s.mode.toUpperCase();
    const cmdText = s.mode === 'fields' ? (s.fields.step === 'title' ? '-- INSERT --  title · Enter  (or "Title - Author")  · Esc cancels' : '-- INSERT --  author · Enter  (empty skips)  · Esc cancels') : s.mode === 'command' ? ':' + s.cmd : s.mode === 'search' ? '/' + s.cmd : L ? (L.vmode === 'insert' ? '-- INSERT --  Esc → normal · [ links a tag' : L.vmode === 'visual' ? '-- VISUAL --  d delete · y yank · c change · t tag · Esc' : L.vmode === 'vline' ? '-- VISUAL LINE --  d delete · y yank · c change · t tag · Esc' : s.msg || (s.longText !== L.saved ? '[+] modified · :w writes · :wq writes and closes · :q! discards' : ':q closes · i insert · v visual')) : s.mode === 'visual' ? '-- VISUAL LINE --  d delete · y yank · Esc' : s.msg || (s.search ? `/${s.search}  (Esc clears)` : '');
    const cmdCursorAt = s.mode === 'command' || s.mode === 'search' ? 1 + Math.min(s.cmdc, s.cmd.length) : null;   // +1 for the : or / prefix
    const comps = s.mode === 'command' ? CMDS.filter(c => c[0].startsWith(s.cmd) && s.cmd.length > 0 || (!s.cmd && ['q', 'new book <title>', 'quote', 'def <word>', 'help'].includes(c[0]))).slice(0, 6).map((c, i) => ({ label: ':' + c[0], hint: c[1], bg: i === 0 && s.cmd ? 'var(--hl,#f3f1ec)' : 'transparent', prefix: c[0].replace(/<.*>/, '').trimEnd() + (c[0].includes('<') ? ' ' : ''), arg: c[0].includes('<') })) : [];
    const tq = this.tagQuery(), tagOpts = tq !== null ? this.tagOptions(tq.q).map((o, i) => ({ ...o, label: (tq.close === ')' ? '(' : '[') + o.name + tq.close, hint: o.create ? 'new tag' : `${idx.get(o.name).refs.length} ${idx.get(o.name).refs.length === 1 ? 'place' : 'places'}`, bg: i === (L ? L.tagSel : 0) % Math.max(1, this.tagOptions(tq.q).length) ? 'var(--hl,#f3f1ec)' : 'transparent' })) : [];
    const hoverEntry = s.hover ? idx.get(s.hover.tag) : null;
    const hover = s.hover ? { ...s.hover, name: s.hover.tag, refs: hoverEntry ? hoverEntry.refs.slice(0, 8) : [], total: hoverEntry ? hoverEntry.refs.length : 0 } : null;
    const cursorIdx = s.focus === 'side' ? s.side : s.cur, navN = s.focus === 'side' ? this.sideList().length : items.length;
    const actions = [['new', 'new'], ['edit', 'edit'], ['del', 'delete'], ['undo', 'undo'], [':cmd', 'cmd'], ['?', 'help'], [s.theme === 'light' ? 'dark' : 'light', 'theme'], ['sidebar', 'sidebar']].map(([label, name]) => ({ label, name }));
    const cmdBtns = s.mode === 'fields' ? [['next', 'done'], ['cancel', 'cancel']] : s.long && s.mode !== 'command' ? [['write', 'write'], ['write & close', 'keep'], ['close', 'close']] : s.mode === 'command' ? [['run', 'run'], ['cancel', 'cancel']] : s.mode === 'search' ? [['apply', 'apply'], ['cancel', 'cancel']] : s.mode === 'visual' ? [['delete', 'delete'], ['yank', 'yank'], ['cancel', 'cancel']] : s.search ? [['clear search', 'clear']] : [];
    return {
      th, sidebarOpen: s.sidebar, sideItems, tags, crumbs, summary, statusPath, isEmpty: v.type === 'empty', isThread: v.type === 'thread' && !!quote, quote: quote || {}, isWord: !!word, word: word || {}, showLines: !s.long && v.type !== 'empty' && v.type !== 'word', lines,
      longform: !!L, bufTitle, bufHint, vclass: L ? (L.vmode === 'insert' ? 'vinsert' : L.vmode === 'normal' ? 'vnormal' : 'vvisual') : '', longRef: this.longRef, mirrorRef: this.mirrorRef, longText: s.longText,
      onLongChange: e => { const el = e.target; this.setState({ longText: el.value, long: { ...this.state.long, caret: el.selectionStart, c: el.selectionStart } }); },
      onLongSelect: e => { const l = this.state.long; if (l && l.vmode === 'insert' && l.caret !== e.target.selectionStart) this.setState({ long: { ...l, caret: e.target.selectionStart } }); },
      onLongMouseUp: e => { const l = this.state.long, i = l && this.idxAt(e.clientX, e.clientY); if (l && i != null && (l.vmode === 'normal' || l.vmode === 'insert')) this.setC(i, { vmode: l.vmode }); },
      onLongScroll: e => { const m = this.mirrorRef.current; if (m) m.style.transform = `translateY(${-e.target.scrollTop}px)`; },
      marks: this.bufMarks(s.longText, L), onLongMove: e => this.hoverBuf(e), onLongLeave: () => this.hoverBuf(null),
      showComp: comps.length > 0, comps, showTagPop: tagOpts.length > 0, tagOpts, showHelp: s.help, helpRows: HELP.map(([k, v]) => ({ k, v })), hover,
      store: s.archive ? (s.archiveState === 'saved' ? 'archive' : s.archiveState === 'error' ? 'archive!' : 'archive…') : 'local', storeTitle: s.archive || 'localStorage only (no dev server)',
      modeLabel, showcmd: (s.count + s.pending).replace(' ', '␣'), pos: `${Math.min(cursorIdx + 1, Math.max(navN, 1))},1  ${navN ? 'All' : '—'}`,
      cmdText, cmdPre: cmdCursorAt === null ? cmdText : cmdText.slice(0, cmdCursorAt), cmdAt: cmdCursorAt === null ? '' : cmdText[cmdCursorAt] || ' ', cmdPost: cmdCursorAt === null ? '' : cmdText.slice(cmdCursorAt + 1), cmdColor: s.mode === 'command' || s.mode === 'search' ? 'var(--ink,#111)' : 'var(--muted,#8a877f)', cmdCursor: cmdCursorAt !== null, cmdBtns, actions,
      focusRoot: e => { const t = e.target.tagName; if (t !== 'TEXTAREA' && t !== 'INPUT') e.currentTarget.focus(); },
    };
  }
  render() {
    const V = this.renderVals();
    const { th } = V;
    const rootStyle = { '--bg': th.bg, '--ink': th.ink, '--muted': th.muted, '--faint': th.faint, '--line': th.line, '--hl': th.hl, '--bar': th.bar };
    const stop = f => e => { e.stopPropagation(); f(e); };
    return (
      <div className="app" tabIndex={0} onClick={V.focusRoot} style={rootStyle}>
        <div className="body">
          {V.sidebarOpen && (
            <div className="side">
              <div className="side-group">
                <div className="side-label">BOOKS</div>
                {V.sideItems.filter(s => s.group === 'books').map(s => (
                  <div key={s.i} className={s.sub ? 'side-item side-sub' : 'side-item'} style={{ background: s.bg, fontWeight: s.weight }} onClick={() => this.clickSide(s.i)}>
                    <span>{s.label}</span><span>{s.counts}</span>
                  </div>
                ))}
              </div>
              <div className="side-group">
                <div className="side-label">VOCAB</div>
                {V.sideItems.filter(s => s.group === 'all').map(s => (
                  <div key={s.i} className="side-item" style={{ background: s.bg, fontWeight: s.weight }} onClick={() => this.clickSide(s.i)}>
                    <span>{s.label}</span><span>{s.counts}</span>
                  </div>
                ))}
              </div>
              <div className="side-group">
                <div className="side-label">TAGS</div>
                <div className="tags">
                  {V.tags.map((tg, i) => <span key={i} className={tg.on ? 'tag on' : 'tag'} onClick={() => this.openTag(tg.name)}>#{tg.name} <span>{tg.n}</span></span>)}
                  {!V.tags.length && <span className="tags-empty">write [word] in any line</span>}
                </div>
              </div>
              <div className="side-foot">{'\\b · ␣ee toggles · C-h/C-l switch pane'}</div>
            </div>
          )}
          <div className="main">
            {!V.isEmpty && (
              <div className="crumbs">
                <span>{V.crumbs.map((c, i) => <span key={i} className="crumb" onClick={c.go}>{c.label}</span>)}</span>
                <span>{V.summary}</span>
              </div>
            )}
            {V.isThread && (
              <div className="quote">
                <div className="quote-text">“{this.rich(V.quote.text)}”</div>
                <div className="quote-meta"><span>{V.quote.ref}</span><span>{V.quote.page}</span><span>{V.quote.count}</span></div>
              </div>
            )}
            {V.isWord && (
              <div className="word">
                <div className="word-head"><span className="word-word">{V.word.word}</span><span className="word-meta">{V.word.meta}</span></div>
                <div className="word-sec"><div className="word-label">your note</div><div>{this.rich(V.word.note)}</div></div>
                <div className="word-sec"><div className="word-label">where</div><div className="word-where">{V.word.where}</div></div>
                {V.word.sections.map((x, i) => <div key={i} className="word-sec"><div className="word-label">{x.label}</div><div>{x.text}</div></div>)}
                <div className="word-foot">{V.word.foot}</div>
                <div className="tilde">~</div>
              </div>
            )}
            {V.showLines && (
              <div className="grid">
                {V.lines.map((ln, i) => ln.isHeader ? (
                  <div key={i} className="hdr">
                    <span></span><span>{ln.pre}</span><span>{ln.main}</span><span>{ln.a}</span><span>{ln.b}</span><span>{ln.c}</span><span>{ln.d}</span>
                  </div>
                ) : ln.isRow ? (
                  <div key={i} className={(ln.idx === undefined ? 'row' : 'row clickable') + (ln.cur ? ' cur' : '')} style={{ background: ln.bg, fontWeight: ln.weight }} onClick={() => this.clickRow(ln.idx)} onDoubleClick={() => this.dblRow(ln.idx)}>
                    <span className="row-num" style={{ color: ln.numColor }}>{ln.num}</span>
                    <span className="row-pre">{ln.pre}</span>
                    <span className="row-main" style={{ color: ln.mainColor, paddingLeft: ln.indent ? ln.indent * 22 : 0 }}>
                      {ln.fields ? ln.fields.map((f, j) => (
                        <React.Fragment key={j}>{j > 0 && <span className="row-sub"> — </span>}{f.active ? <>{f.text.slice(0, ln.pos)}<span className="caret">{f.text[ln.pos] || ' '}</span>{f.text.slice(ln.pos + 1)}{!f.text && <span className="ph">{f.ph}</span>}</> : f.text || <span className="ph">{f.ph}</span>}</React.Fragment>
                      )) : <>{ln.indent ? <span className="row-sub">↳ </span> : null}{this.rich(ln.main)}</>}
                      <span className="row-sub"> {ln.sub}</span>
                    </span>
                    <span className="row-a">{ln.a}</span>
                    <span className="row-b">{ln.b}</span>
                    <span className="row-c">{ln.c}</span>
                    <span className="row-d">{ln.d}</span>
                  </div>
                ) : null)}
                <div className="tilde">~</div>
              </div>
            )}
            {V.longform && (
              <div className="long">
                <div className="long-label"><span>{V.bufTitle}</span><span>{V.bufHint}</span></div>
                <div className="buf-wrap">
                  <textarea ref={V.longRef} className={'buf ' + V.vclass} value={V.longText} onChange={V.onLongChange} onSelect={V.onLongSelect} onMouseUp={V.onLongMouseUp} onScroll={V.onLongScroll} onMouseMove={V.onLongMove} onMouseLeave={V.onLongLeave} spellCheck={false} />
                  <div ref={V.mirrorRef} className="buf mirror" aria-hidden="true">{V.marks}</div>
                </div>
              </div>
            )}
          </div>
        </div>
        {V.hover && (
          <div className="hover" style={{ left: V.hover.x, top: V.hover.y ?? 'auto', bottom: V.hover.bottom ?? 'auto' }} onMouseEnter={() => this.keepHover()} onMouseLeave={() => this.hideHover()}>
            <div className="hover-head"><b onClick={stop(() => this.openTag(V.hover.name))}>#{V.hover.name}</b><span>{V.hover.total} {V.hover.total === 1 ? 'place' : 'places'}</span></div>
            {V.hover.refs.map((r, i) => <div key={i} className="hover-row" onClick={stop(() => this.goRef(r))}><span>{r.label}</span><span>{r.text}</span></div>)}
            {!V.hover.refs.length && <div className="hover-row"><span></span><span className="muted">not used anywhere else</span></div>}
            <div className="hover-foot" onClick={stop(() => this.openTag(V.hover.name))}>open tag view →</div>
          </div>
        )}
        <div className="bottom">
          {V.showComp && (
            <div className="popup comp">
              {V.comps.map((cp, i) => (
                <div key={i} className="comp-row" style={{ background: cp.bg }} onClick={stop(() => this.clickComp(cp))}><span>{cp.label}</span><span>{cp.hint}</span></div>
              ))}
            </div>
          )}
          {V.showTagPop && (
            <div className="popup comp">
              {V.tagOpts.map((o, i) => (
                <div key={i} className="comp-row" style={{ background: o.bg }} onClick={stop(() => this.acceptTag(o))}><span className="link">{o.label}</span><span>{o.hint}</span></div>
              ))}
              <div className="comp-foot">Tab / ↑↓ choose · Enter insert · Esc dismiss</div>
            </div>
          )}
          {V.showHelp && (
            <div className="popup help">
              {V.helpRows.map((h, i) => <React.Fragment key={i}><span className="help-k">{h.k}</span><span>{h.v}</span></React.Fragment>)}
            </div>
          )}
          <div className="status">
            <span className="status-l"><span className="status-mode">{V.modeLabel}</span><span className="status-path">{V.statusPath}</span></span>
            <span className="status-r">
              <span className="actions">{V.actions.map(a => <span key={a.name} className="action" onClick={stop(() => this.action(a.name))}>{a.label}</span>)}</span>
              <span title={V.storeTitle}>{V.store}</span><span>{V.showcmd}</span><span>{V.pos}</span>
            </span>
          </div>
          <div className="cmdline" style={{ color: V.cmdColor }} onClick={() => { if (this.state.mode === 'normal' && !this.state.long) this.action('cmd'); }}>
            <span>{V.cmdPre}{V.cmdCursor && <span className="caret">{V.cmdAt}</span>}{V.cmdPost}</span>
            <span className="cmd-btns">{V.cmdBtns.map(([label, name]) => <span key={name} className="cmd-btn" onClick={stop(() => this.action(name))}>{label}</span>)}</span>
          </div>
        </div>
      </div>
    );
  }
}
