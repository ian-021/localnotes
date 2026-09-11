import React from 'react';
import { THEMES, id, seed, touched, fmtDay, fmtTime, CMDS, HELP, slugOf, reslug, splitTitle } from './data.js';
import { lookup, hasKey, FIELDS } from './ai.js';

const LINK_RE = /\[([^\[\]\n]+)\]/g;
const norm = name => String(name || '').replace(/^#/, '').trim().toLowerCase();
const tagsOf = text => [...String(text || '').matchAll(LINK_RE)].map(m => norm(m[1])).filter(Boolean);
const qn = (bk, qq) => 'q' + String(bk.quotes.indexOf(qq) + 1).padStart(2, '0');
const SECS = ['quotes', 'vocab'];

export default class Notes extends React.Component {
  constructor(p) {
    super(p);
    let data = null, ui = {};
    try { data = JSON.parse(localStorage.getItem('notes.data.v1')); ui = JSON.parse(localStorage.getItem('notes.ui.v1')) || {}; } catch (e) {}
    if (Array.isArray(data)) { data.forEach(b => { if (!b.author) { const [t, a] = splitTitle(b.title); if (a) { b.title = t; b.author = a; } } }); reslug(data); }
    this.state = {
      books: data || seed(), theme: ui.theme || p.theme || 'light', sidebar: ui.sidebar ?? (p.sidebarOpen ?? true), nu: ui.nu ?? true,
      view: { type: 'library' }, cur: 0, side: 0, expanded: ui.expanded || {}, focus: 'main', mode: 'normal', pending: '', count: '',
      cmd: '', search: '', filter: '', msg: '', vanchor: null, edit: null, insertText: '', ipos: 0, long: null, longText: '', help: false,
      hover: null, tagSel: 0, tagPopClosed: false, aiBusy: null, archive: null, archiveState: '',
    };
    this.undo = []; this.longRef = React.createRef();
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
        qq.thoughts.forEach(t => { const tref = { kind: 'thought', bookId: bk.id, quoteId: qq.id, id: t.id, label: `${bk.slug}/${qn(bk, qq)}`, text: t.text }; tagsOf(t.text).forEach(n => add(n, tref)); });
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
    if (v.type === 'thread') { const q = this.quote(); if (!q) return []; return q.thoughts.filter(t => hit(t.text)).map(t => ({ kind: 'thought', q, t })); }
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
    return this.setState({ ...base, view: { type: 'thread', bookId: bk.id, quoteId: qq.id }, cur: Math.max(0, qq.thoughts.findIndex(t => t.id === r.id)) });
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
  // ---- editing
  startEdit(at = 'end') {
    const it = this.items()[this.state.cur]; if (!it) return;
    if (it.kind === 'ref') return this.goRef(it.r);
    const text = it.kind === 'book' ? it.b.title : it.kind === 'quote' ? it.q.text : it.kind === 'vocab' ? it.w.def : it.t.text;
    this.setState({ mode: 'insert', edit: { kind: it.kind, bookId: it.b ? it.b.id : undefined, id: (it.b || it.q || it.w || it.t).id, target: it.kind === 'book' ? it.b.id : it.kind === 'quote' ? it.q.id : it.kind === 'vocab' ? it.w.id : it.t.id, isNew: false }, insertText: text, ipos: at === 'start' ? 0 : text.length, msg: '', tagPopClosed: true, tagSel: 0 });
  }
  startNew(kind, extra = {}, text = '') { this.setState({ mode: 'insert', edit: { kind, isNew: true, ...extra }, insertText: text, ipos: text.length, msg: '', tagPopClosed: true, tagSel: 0 }); }
  newHere() {
    const s = this.state, v = s.view, it = this.items()[s.cur];
    if (v.type === 'library') this.startNew('book');
    else if (v.type === 'book') v.sec === 'vocab' ? this.startNew('vocabword') : this.startNew('quote');
    else if (v.type === 'thread') this.setState({ long: { isNew: true, vmode: 'insert', saved: '', undo: [], pending: '' }, longText: '', mode: 'normal', msg: '' });
    else if (v.type === 'tag') this.setState({ msg: 'open an item to add to it' });
    else if (v.type === 'vocab') this.setState({ msg: 'open a word to add to its book · :def inside a book' });
    else if (v.type === 'word') this.setState({ msg: 'q to go back · r to ask again' });
    else if (v.type === 'empty') this.setState({ msg: 'open a book first' });
  }
  commitInsert(again) {
    const s = this.state, e = s.edit, text = s.insertText.trim(), v = s.view;
    let next = { mode: 'normal', edit: null, insertText: '', tagPopClosed: false, tagSel: 0 };
    if (!e) return this.setState(next);
    if (e.isNew) {
      const addBook = (title, author) => { this.mutate(bs => bs.push({ id: id(), slug: slugOf(title, bs.map(x => x.slug)), title, author, tags: [], quotes: [], vocab: [] })); next.cur = s.books.length; next.msg = `"${title}"${author ? ' — ' + author : ''} created`; };
      if (e.kind === 'bookauthor') { addBook(e.title, text); return this.setState(next); }
      if (!text) return this.setState(next);
      if (e.kind === 'book') { const [title, author] = splitTitle(text); if (author) addBook(title, author); else next = { ...next, mode: 'insert', edit: { kind: 'bookauthor', isNew: true, title }, insertText: '', ipos: 0, msg: 'author · Enter to skip' }; }
      else if (e.kind === 'quote') { this.mutate(bs => { const b = bs.find(b => b.id === v.bookId); b.quotes.push({ id: id(), text, page: e.page || null, thoughts: [] }); }); const b = this.book(); next.cur = b.quotes.length; next.msg = 'quote added · :page <n> to set page'; Object.assign(next, { view: { type: 'book', bookId: v.bookId, sec: 'quotes' } }, this.sidePos(v.bookId, 'quotes')); }
      else if (e.kind === 'vocabword') { next = { ...next, mode: 'insert', edit: { kind: 'vocabdef', isNew: true, word: text }, insertText: '', ipos: 0 }; next.msg = `definition for “${text}”`; }
      else if (e.kind === 'vocabdef') { this.mutate(bs => { const b = bs.find(b => b.id === v.bookId); b.vocab.push({ id: id(), word: e.word, def: text, at: Date.now() }); }); const b = this.book(); next.cur = b.vocab.length; Object.assign(next, { view: { type: 'book', bookId: v.bookId, sec: 'vocab' } }, this.sidePos(v.bookId, 'vocab')); }
      else if (e.kind === 'thought') { this.mutate(bs => { const q = bs.find(b => b.id === v.bookId).quotes.find(q => q.id === v.quoteId); q.thoughts.push({ id: id(), text, at: Date.now() }); }); next.cur = this.quote().thoughts.length; if (again) { next.mode = 'insert'; next.edit = e; } }
    } else {
      this.mutate(bs => {
        const b = bs.find(b => b.id === (e.bookId || v.bookId || e.target));
        if (e.kind === 'book') { const bb = bs.find(b => b.id === e.target); if (text) { bb.title = text; bb.slug = slugOf(text, bs.filter(x => x !== bb).map(x => x.slug)); } }
        else if (e.kind === 'quote') { const q = b.quotes.find(q => q.id === e.target); if (text) q.text = text; }
        else if (e.kind === 'vocab') { const w = b.vocab.find(w => w.id === e.target); w.def = text; }
        else if (e.kind === 'thought') { const q = b.quotes.find(q => q.id === v.quoteId); const t = q.thoughts.find(t => t.id === e.target); if (text) t.text = text; else q.thoughts.splice(q.thoughts.indexOf(t), 1); }
      });
    }
    this.setState(next);
  }
  // ---- long-form editor: :w writes, :q closes, :wq both, :q! discards
  writeLong() {
    const s = this.state, v = s.view, L = s.long, text = s.longText.trim(); if (!L || !text) return false;
    let tid = L.id;
    this.mutate(bs => { const q = bs.find(b => b.id === v.bookId).quotes.find(q => q.id === v.quoteId); if (L.isNew) { tid = id(); q.thoughts.push({ id: tid, text, at: Date.now() }); } else { const t = q.thoughts.find(t => t.id === L.id); if (t) t.text = text; } });
    this.setState({ long: { ...L, isNew: false, id: tid, saved: s.longText } });
    return tid;
  }
  closeLong(tid) {
    const s = this.state, q = this.quote(), L = s.long || {};
    const idv = tid || L.id, i = q && idv ? q.thoughts.findIndex(t => t.id === idv) : -1;
    this.setState({ long: null, longText: '', mode: 'normal', cmd: '', cur: i >= 0 ? i : L.isNew && q ? Math.max(0, q.thoughts.length - 1) : s.cur });
  }
  commitLong() {
    const s = this.state; if (!s.long) return;
    const tid = this.writeLong();
    this.closeLong(tid || undefined);
    this.setState({ msg: tid ? 'written' : s.longText.trim() ? '' : 'discarded (empty)' });
  }
  longEl() { return this.longRef.current; }
  longCaret(c) { const el = this.longEl(); if (!el) return; c = Math.max(0, Math.min(this.state.longText.length, c)); el.setSelectionRange(c, c); }
  longSet(text, caret, extra) { this.setState({ longText: text, long: { ...this.state.long, pending: '', ...extra } }, () => this.longCaret(caret)); }
  longKey(e) {
    const s = this.state, L = s.long, k = e.key, el = this.longEl(), t = s.longText, c = el ? el.selectionStart : 0;
    if (L.vmode === 'insert') { if (k === 'Escape') { e.preventDefault(); this.setState({ long: { ...L, vmode: 'normal', pending: '' } }, () => this.longCaret(Math.max(0, c - 1))); } return; }
    if (['Shift', 'CapsLock', 'Meta', 'Alt', 'Control'].includes(k)) return;
    e.preventDefault();
    const ls = p => t.lastIndexOf('\n', p - 1) + 1, le = p => { const i = t.indexOf('\n', p); return i < 0 ? t.length : i; };
    const snap = [...L.undo, { t, c }].slice(-50);
    const ins = (text, caret) => this.longSet(text, caret, { vmode: 'insert', undo: snap });
    const seq = L.pending + k;
    if (seq === 'dd') { const a = ls(c), b = le(c), nt = t.slice(0, a) + t.slice(Math.min(t.length, b + 1)); return this.longSet(nt, Math.min(a, nt.length), { undo: snap }); }
    if (seq === 'gg') return this.setState({ long: { ...L, pending: '' } }, () => this.longCaret(0));
    if (L.pending) return this.setState({ long: { ...L, pending: '' } });
    if (k === 'd' || k === 'g') return this.setState({ long: { ...L, pending: k } });
    switch (k) {
      case 'i': return ins(t, c);
      case 'a': return ins(t, c < t.length && t[c] !== '\n' ? c + 1 : c);
      case 'I': return ins(t, ls(c));
      case 'A': return ins(t, le(c));
      case 'o': { const b = le(c); return ins(t.slice(0, b) + '\n' + t.slice(b), b + 1); }
      case 'O': { const a = ls(c); return ins(t.slice(0, a) + '\n' + t.slice(a), a); }
      case 'h': case 'ArrowLeft': case 'Backspace': return this.longCaret(c - 1);
      case 'l': case 'ArrowRight': case ' ': return this.longCaret(c + 1);
      case 'j': case 'ArrowDown': case 'Enter': { const b = le(c); if (b >= t.length) return; const col = c - ls(c), na = b + 1; return this.longCaret(Math.min(na + col, Math.max(na, le(na) - 1))); }
      case 'k': case 'ArrowUp': { const a = ls(c); if (!a) return; const col = c - a, pa = ls(a - 1); return this.longCaret(Math.min(pa + col, Math.max(pa, a - 2))); }
      case '0': case 'Home': return this.longCaret(ls(c));
      case '^': { let i = ls(c); while (i < le(c) && /\s/.test(t[i])) i++; return this.longCaret(i); }
      case '$': case 'End': return this.longCaret(Math.max(ls(c), le(c) - 1));
      case 'w': { let i = c; while (i < t.length && /\S/.test(t[i])) i++; while (i < t.length && /\s/.test(t[i])) i++; return this.longCaret(i); }
      case 'b': { let i = c; while (i > 0 && /\s/.test(t[i - 1])) i--; while (i > 0 && /\S/.test(t[i - 1])) i--; return this.longCaret(i); }
      case 'e': { let i = c + 1; while (i < t.length && /\s/.test(t[i])) i++; while (i + 1 < t.length && /\S/.test(t[i + 1])) i++; return this.longCaret(Math.min(i, t.length - 1)); }
      case 'G': return this.longCaret(t.length);
      case 'x': if (c < t.length && t[c] !== '\n') return this.longSet(t.slice(0, c) + t.slice(c + 1), c, { undo: snap }); return;
      case 'u': { if (!L.undo.length) return this.setState({ msg: 'already at oldest change' }); const u = L.undo[L.undo.length - 1]; return this.longSet(u.t, u.c, { undo: L.undo.slice(0, -1) }); }
      case ':': return this.setState({ mode: 'command', cmd: '', msg: '', help: false });
      case '?': return this.setState({ help: !s.help });
      case 'Escape': return this.setState({ long: { ...L, pending: '' }, msg: '', help: false });
    }
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
          else { const q = bb.quotes.find(q => q.id === v.quoteId); q.thoughts.splice(q.thoughts.findIndex(t => t.id === it.t.id), 1); } }
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
    if (s.mode === 'insert') return this.commitInsert(false);
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
      if (!['theme', 'colorscheme', 'set', 'help', 'h'].includes(head)) return set({ msg: 'in long-form: :w :wq :q :q!' });
    }
    if (head === 'q' || head === 'quit') { set({}); return this.back(); }
    if (head === 'new') { const [what, ...t] = rest; const title = t.join(' '); if (what === 'book') { if (!title) return this.startNew('book'); this.setState({ mode: 'normal', cmd: '', edit: { kind: 'book', isNew: true }, insertText: title }, () => this.commitInsert(false)); return; } if (what === 'thought' && v.type === 'thread') return set({ long: { isNew: true, vmode: 'insert', saved: '', undo: [], pending: '' }, longText: '', mode: 'normal' }); return set({ msg: 'usage: :new book <title>' }); }
    if (head === 'quote') { if (v.type !== 'book') return set({ msg: 'open a book first' }); const sw = { view: { type: 'book', bookId: v.bookId, sec: 'quotes' }, ...this.sidePos(v.bookId, 'quotes') }; if (!arg) { set(sw); return this.startNew('quote'); } this.setState({ mode: 'normal', cmd: '', ...sw, edit: { kind: 'quote', isNew: true }, insertText: arg }, () => this.commitInsert(false)); return; }
    if (head === 'def') { if (v.type !== 'book') return set({ msg: 'open a book first' }); const sw = { view: { type: 'book', bookId: v.bookId, sec: 'vocab' }, ...this.sidePos(v.bookId, 'vocab') }; set(sw); return arg ? this.startNew('vocabdef', { word: arg }) : this.startNew('vocabword'); }
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
    if (head === 'ai' || head === 'lookup') { if (v.type === 'word') { set({}); return this.loadAI(true); } const it = this.items()[s.cur]; if (it && it.kind === 'vocab') { set({}); return this.openWord(it.b.id, it.w.id); } return set({ msg: 'put the cursor on a word first' }); }
    set({ msg: `not a command: ${head}` });
  }
  // ---- clipboard
  itemText(it) { return it ? (it.kind === 'ref' ? it.r.text : it.kind === 'vocab' ? `${it.w.word} — ${it.w.def}` : it.b?.title || it.q?.text || it.t?.text || '') : ''; }
  yankRange(a, b) {
    const its = this.items().slice(Math.min(a, b), Math.max(a, b) + 1);
    return its.map(it => this.itemText(it)).join('\n');
  }
  copy(e) {
    const s = this.state;
    if (s.long || s.focus === 'side' || s.mode === 'insert' || s.mode === 'command' || s.mode === 'search') return;
    if (String(window.getSelection && window.getSelection()).length) return;
    const vis = s.mode === 'visual' && s.vanchor !== null;
    const a = vis ? s.vanchor : s.cur, b = s.cur, txt = this.yankRange(a, b);
    if (!txt) return;
    e.clipboardData.setData('text/plain', txt); e.preventDefault();
    const n = Math.abs(b - a) + 1;
    this.setState({ mode: 'normal', vanchor: null, msg: `${n} ${n === 1 ? 'line' : 'lines'} yanked` });
  }
  paste(e) {
    const s = this.state;
    if (s.long) return;
    const raw = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!raw) return;
    e.preventDefault();
    this.pasteText(raw);
  }
  pasteText(raw) {
    const s = this.state, flat = raw.replace(/\r?\n+/g, ' '), text = flat.trim();
    if (s.mode === 'insert') { const t = s.insertText, p = Math.min(s.ipos, t.length); return this.setState({ insertText: t.slice(0, p) + flat + t.slice(p), ipos: p + flat.length }); }
    if (s.mode === 'command') return this.setState({ cmd: s.cmd + flat });
    if (s.mode === 'search') { const cmd = s.cmd + flat; return this.setState({ cmd, filter: cmd, cur: 0 }); }
    if (!text) return;
    if (s.focus === 'side') return;
    const v = s.view;
    if (v.type === 'library') return this.setState({ mode: 'normal', vanchor: null }, () => this.startNew('book', {}, text));
    if (v.type === 'book') return this.setState({ mode: 'normal', vanchor: null }, () => this.startNew(v.sec === 'vocab' ? 'vocabword' : 'quote', {}, text));
    if (v.type === 'thread') return this.setState({ mode: 'normal', vanchor: null }, () => this.startNew('thought', {}, text));
  }
  // ---- tag completion (insert mode)
  tagQuery() {
    const s = this.state; if (s.mode !== 'insert' || s.long || s.tagPopClosed) return null;
    const t = s.insertText.slice(0, s.ipos), i = t.lastIndexOf('['); if (i < 0) return null;
    const rest = t.slice(i + 1); return rest.includes(']') ? null : rest;
  }
  tagOptions(q) {
    const all = [...this.tagIndex().keys()].sort(), ql = norm(q);
    const list = all.filter(n => n.includes(ql)).map(n => ({ name: n, create: false }));
    if (ql && !all.includes(ql)) list.push({ name: ql, create: true });
    return list.slice(0, 8);
  }
  acceptTag(opt) {
    const s = this.state, t = s.insertText, p = Math.min(s.ipos, t.length), i = t.slice(0, p).lastIndexOf('[');
    if (i < 0 || !opt) return;
    this.setState({ insertText: t.slice(0, i + 1) + opt.name + ']' + t.slice(p), ipos: i + opt.name.length + 2, tagSel: 0, tagPopClosed: false });
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
    const s = this.state;
    if (e.metaKey && e.code === 'Space') { e.preventDefault(); this.pending(' '); return; }
    if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'h' || e.key === 'l') && !s.long && s.mode !== 'command' && s.mode !== 'search' && s.mode !== 'insert') { e.preventDefault(); return this.focusPane(e.key === 'h' ? 'side' : 'main'); }
    const tq = s.mode === 'insert' && !s.long ? this.tagQuery() : null, opts = tq !== null ? this.tagOptions(tq) : [];
    if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'n' || e.key === 'p') && opts.length) { e.preventDefault(); return this.setState({ tagSel: (s.tagSel + (e.key === 'n' ? 1 : opts.length - 1)) % opts.length }); }
    if ((e.metaKey || e.ctrlKey || e.altKey) && !(e.metaKey && e.ctrlKey)) {
      if (s.mode === 'insert' && !s.long && this.editShortcut(e)) return;
      if ((s.mode === 'command' || s.mode === 'search') && this.cmdShortcut(e)) return;
      if (s.long && s.long.vmode === 'insert' && s.mode !== 'command' && this.longChop(e)) return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (s.long && s.mode !== 'command') return this.longKey(e);
    const k = e.key;
    if (k === 'Shift' || k === 'CapsLock') return;
    if (k === 'Tab' && !(s.mode === 'command' || opts.length)) return;
    e.preventDefault();
    if (s.mode === 'command' || s.mode === 'search') {
      const isCmd = s.mode === 'command';
      if (k === 'Escape') return this.setState({ mode: 'normal', cmd: '', filter: isCmd ? s.filter : s.search });
      if (k === 'Enter') { if (isCmd) return this.runCmd(s.cmd); return this.setState({ mode: 'normal', search: s.filter, cmd: '', msg: this.items().length + ' match' + (this.items().length === 1 ? '' : 'es') + (s.filter ? ' · Esc clears' : '') }); }
      if (k === 'Backspace') { if (!s.cmd) return this.setState({ mode: 'normal', filter: isCmd ? s.filter : s.search }); const cmd = s.cmd.slice(0, -1); return this.setState({ cmd, filter: isCmd ? s.filter : cmd, cur: isCmd ? s.cur : 0 }); }
      if (k === 'Tab' && isCmd) { const m = CMDS.find(c => c[0].startsWith(s.cmd)); if (m) this.setState({ cmd: m[0].replace(/<.*>/, '').trimEnd() + (m[0].includes('<') ? ' ' : '') }); return; }
      if (k.length === 1) { const cmd = s.cmd + k; return this.setState({ cmd, filter: isCmd ? s.filter : cmd, cur: isCmd ? s.cur : 0 }); }
      return;
    }
    if (s.mode === 'insert') {
      if (opts.length) {
        if (k === 'Enter') return this.acceptTag(opts[s.tagSel % opts.length]);
        if (k === 'Tab' || k === 'ArrowDown') return this.setState({ tagSel: (s.tagSel + 1) % opts.length });
        if (k === 'ArrowUp') return this.setState({ tagSel: (s.tagSel + opts.length - 1) % opts.length });
        if (k === 'Escape') return this.setState({ tagPopClosed: true, tagSel: 0 });
      }
      const t = s.insertText, p = Math.min(s.ipos, t.length), put = (str, o = {}) => this.setState({ insertText: t.slice(0, p) + str + t.slice(p), ipos: p + str.length, tagSel: 0, ...o });
      if (k === 'Escape') return this.commitInsert(false);
      if (k === 'Enter') return this.commitInsert(true);
      if (k === 'Backspace') { if (!p) return; return this.setState({ insertText: t.slice(0, p - 1) + t.slice(p), ipos: p - 1, tagSel: 0 }); }
      if (k === 'Delete') return this.setState({ insertText: t.slice(0, p) + t.slice(p + 1), tagSel: 0 });
      if (k === 'ArrowLeft') return this.setState({ ipos: Math.max(0, p - 1) });
      if (k === 'ArrowRight') return this.setState({ ipos: Math.min(t.length, p + 1) });
      if (k === 'Home') return this.setState({ ipos: 0 });
      if (k === 'End') return this.setState({ ipos: t.length });
      if (k === '[') return put('[', { tagPopClosed: false });
      if (k.length === 1) return put(k);
      return;
    }
    // normal / visual
    if (k === 'Escape') return this.setState({ mode: 'normal', vanchor: null, pending: '', count: '', msg: '', help: false, filter: '', search: '', hover: null });
    if (/^[1-9]$/.test(k) || (k === '0' && s.count)) return this.setState({ count: s.count + k });
    this.pending(k);
  }
  // ---- mac / emacs / vim-insert editing shortcuts in the one-line editor
  editShortcut(e) {
    const s = this.state, t = s.insertText, p = Math.min(s.ipos, t.length), k = e.key, alt = e.altKey && !e.metaKey && !e.ctrlKey, meta = e.metaKey && !e.altKey, ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
    const back = i => { while (i > 0 && /\s/.test(t[i - 1])) i--; while (i > 0 && /\S/.test(t[i - 1])) i--; return i; };
    const fwd = i => { while (i < t.length && /\s/.test(t[i])) i++; while (i < t.length && /\S/.test(t[i])) i++; return i; };
    let ipos, text = null;
    if (alt && k === 'ArrowLeft') ipos = back(p);
    else if (alt && k === 'ArrowRight') ipos = fwd(p);
    else if ((meta && k === 'ArrowLeft') || (ctrl && k === 'a')) ipos = 0;
    else if ((meta && k === 'ArrowRight') || (ctrl && k === 'e')) ipos = t.length;
    else if ((alt && k === 'Backspace') || (ctrl && k === 'w')) { ipos = back(p); text = t.slice(0, ipos) + t.slice(p); }
    else if ((meta && k === 'Backspace') || (ctrl && k === 'u')) { ipos = 0; text = t.slice(p); }
    else if (alt && k === 'Delete') { ipos = p; text = t.slice(0, p) + t.slice(fwd(p)); }
    else if ((meta && k === 'Delete') || (ctrl && k === 'k')) { ipos = p; text = t.slice(0, p); }
    else return false;
    e.preventDefault(); this.setState({ ipos, tagSel: 0, ...(text !== null ? { insertText: text } : {}) }); return true;
  }
  cmdShortcut(e) {
    const s = this.state, k = e.key, isCmd = s.mode === 'command', alt = e.altKey && !e.metaKey && !e.ctrlKey, meta = e.metaKey && !e.altKey, ctrl = e.ctrlKey && !e.metaKey && !e.altKey;
    let cmd;
    if ((alt && k === 'Backspace') || (ctrl && k === 'w')) cmd = s.cmd.replace(/\s*\S+\s*$/, '');
    else if ((meta && k === 'Backspace') || (ctrl && k === 'u')) cmd = '';
    else return false;
    e.preventDefault(); this.setState({ cmd, filter: isCmd ? s.filter : cmd, cur: isCmd ? s.cur : 0 }); return true;
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
      case 'i': if (side) return; return this.startEdit('end');
      case 'I': if (side) return; return this.startEdit('start');
      case 'a': if (side) return; return s.view.type === 'thread' ? this.startNew('thought') : this.startEdit('end');
      case 'A': if (side) return; return this.startEdit('end');
      case 'o': case 'O': if (side) return; return this.newHere();
      case 'c': if (side) return; if (s.view.type === 'thread') { const it = this.items()[s.cur]; if (it) return this.setState({ long: { isNew: false, id: it.t.id, vmode: 'normal', saved: it.t.text, undo: [], pending: '' }, longText: it.t.text, mode: 'normal' }); } return;
      case 'v': case 'V': if (side || !n) return; return this.setState({ mode: s.mode === 'visual' ? 'normal' : 'visual', vanchor: s.mode === 'visual' ? null : s.cur });
      case 'd': case 'x': if (s.mode === 'visual') return this.deleteRange(s.vanchor, s.cur); return;
      case 'y': if (s.mode === 'visual') { const a = Math.min(s.vanchor, s.cur), b = Math.max(s.vanchor, s.cur); try { navigator.clipboard.writeText(this.yankRange(a, b)); } catch (e) {} return this.setState({ mode: 'normal', vanchor: null, msg: `${b - a + 1} lines yanked` }); } return;
      case 'p': case 'P': { if (side) return; if (!navigator.clipboard || !navigator.clipboard.readText) return this.setState({ msg: 'clipboard unavailable · use ⌘v' }); navigator.clipboard.readText().then(t => this.pasteText(t)).catch(() => this.setState({ msg: 'clipboard unavailable · use ⌘v' })); return; }
      case 'r': if (s.view.type === 'word') return this.loadAI(true); return;
      case 'u': return this.undoOnce();
      case ':': return this.setState({ mode: 'command', cmd: '', msg: '', help: false });
      case '/': return this.setState({ mode: 'search', cmd: '', filter: '', msg: '', cur: 0 });
      case '?': return this.setState({ help: !s.help });
      case 'n': return this.setState({ msg: s.search ? `filtered by /${s.search}` : 'no previous search' });
      case 'q': return this.back();
    }
  }
  itemsFor(books) { const b = this.state.books; this.state.books = books; const r = this.items(); this.state.books = b; return r; }
  // ---- mouse
  clickRow(i) {
    const s = this.state; if (i === undefined) return;
    if (s.mode === 'insert') this.commitInsert(false);
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
      case 'edit': this.settle(); return s.focus === 'side' ? this.setState({ msg: 'select a line in the main pane' }) : this.startEdit();
      case 'delete': this.settle(); return s.focus === 'side' ? this.setState({ msg: 'delete from the library, not the tree' }) : this.deleteRange(s.mode === 'visual' ? s.vanchor : s.cur, s.cur);
      case 'undo': this.settle(); return this.undoOnce();
      case 'cmd': this.settle(); return this.setState({ mode: 'command', cmd: '', msg: '', help: false });
      case 'help': return this.setState({ help: !s.help });
      case 'theme': return this.setState({ theme: s.theme === 'light' ? 'dark' : 'light' });
      case 'sidebar': return this.setState({ sidebar: !s.sidebar, focus: s.sidebar && s.focus === 'side' ? 'main' : s.focus });
      case 'done': return this.settle();
      case 'run': return this.runCmd(s.cmd);
      case 'apply': return this.setState({ mode: 'normal', search: s.filter, cmd: '' });
      case 'cancel': return this.setState({ mode: 'normal', cmd: '', filter: s.mode === 'search' ? s.search : s.filter, vanchor: null });
      case 'clear': return this.setState({ filter: '', search: '', msg: '' });
      case 'yank': { const a = Math.min(s.vanchor, s.cur), b = Math.max(s.vanchor, s.cur); try { navigator.clipboard.writeText(this.yankRange(a, b)); } catch (e) {} return this.setState({ mode: 'normal', vanchor: null, msg: `${b - a + 1} lines yanked` }); }
      case 'keep': return this.commitLong();
      case 'write': { const ok = this.writeLong(); return this.setState({ msg: ok ? 'written' : 'nothing to write (empty)' }); }
      case 'close': return this.runCmd('q');
    }
  }
  clickComp(cp) { if (cp.arg) return this.setState({ cmd: cp.prefix }); this.runCmd(cp.prefix); }
  // ---- rich text: [tag] links
  rich(text) {
    const str = String(text ?? ''), parts = []; let last = 0, m; const re = new RegExp(LINK_RE.source, 'g');
    while ((m = re.exec(str))) {
      if (m.index > last) parts.push(str.slice(last, m.index));
      const name = norm(m[1]);
      parts.push(<span key={m.index} className="link" onMouseEnter={e => this.showHover(name, e.currentTarget)} onMouseLeave={() => this.hideHover()} onClick={e => { e.stopPropagation(); this.openTag(name); }}>{m[0]}</span>);
      last = m.index + m[0].length;
    }
    if (last < str.length) parts.push(str.slice(last));
    return parts.length ? parts : str;
  }
  // ---- render
  renderVals() {
    const s = this.state, th = THEMES[s.theme], v = s.view, items = this.items(), b = this.book(), q = this.quote(), idx = this.tagIndex();
    const insertAt = s.mode === 'insert' && s.edit;
    const inVis = (i) => s.mode === 'visual' && s.vanchor !== null && i >= Math.min(s.vanchor, s.cur) && i <= Math.max(s.vanchor, s.cur);
    const num = i => !s.nu ? '' : i === s.cur ? String(i + 1) : String(Math.abs(i - s.cur));
    const row = (i, o) => { const sel = i === s.cur && s.focus === 'main'; const editing = insertAt && !s.edit.isNew && o.id === s.edit.target; return { isRow: true, isHeader: false, idx: i, num: num(i), numColor: sel ? 'var(--ink,#111)' : 'var(--faint,#b5b2aa)', bg: sel || inVis(i) ? 'var(--hl,#f3f1ec)' : 'transparent', weight: sel ? 500 : 400, mainColor: 'var(--ink,#111)', pre: '', sub: '', a: '', b: '', c: '', d: '', editing, ...o, main: editing ? s.insertText : o.main, ipos: editing ? s.ipos : 0 }; };
    const header = (pre, main, a = '', bb = '', c = '', d = '') => ({ isHeader: true, isRow: false, pre, main, a, b: bb, c, d });
    const note = main => ({ isRow: true, isHeader: false, num: '', numColor: 'var(--faint)', bg: 'transparent', weight: 400, mainColor: 'var(--muted,#8a877f)', pre: '', main, sub: '', a: '', b: '', c: '', d: '', editing: false });
    const newRow = (kind, o) => ({ isRow: true, isHeader: false, num: '', numColor: 'var(--faint)', bg: 'var(--hl,#f3f1ec)', weight: 400, mainColor: 'var(--ink,#111)', pre: '', sub: '', a: '', b: '', c: '', d: '', editing: true, main: s.insertText, ipos: s.ipos, ...o });
    let lines = [], summary = '', statusPath = 'library', quote = null, word = null;
    let crumbs = [{ label: '~/notes', go: () => this.goView({ type: 'library' }) }];
    if (v.type === 'empty') { crumbs = []; statusPath = '[No Name]'; }
    else if (v.type === 'library') {
      lines.push(header('', 'TITLE', 'QUOTES', 'VOCAB', 'TAGS', 'TOUCHED'));
      items.forEach((it, i) => { const bk = it.b, t = touched(bk); lines.push(row(i, { id: bk.id, main: bk.title, sub: bk.author ? '— ' + bk.author : '', a: String(bk.quotes.length), b: String(bk.vocab.length), c: bk.tags.join(' '), d: t ? fmtDay(t) : '—' })); });
      if (insertAt && s.edit.isNew && (s.edit.kind === 'book' || s.edit.kind === 'bookauthor')) { const onTitle = s.edit.kind === 'book'; lines.push(newRow('book', { fields: [{ text: onTitle ? s.insertText : s.edit.title, ph: 'title', active: onTitle }, { text: onTitle ? '' : s.insertText, ph: 'author', active: !onTitle }] })); }
      if (!items.length && !insertAt) lines.push(note(s.filter ? 'no books match' : 'no books yet — o or :new book <title>'));
      const nq = s.books.reduce((n, x) => n + x.quotes.length, 0), nv = s.books.reduce((n, x) => n + x.vocab.length, 0);
      summary = `${s.books.length} books · ${nq} quotes · ${nv} words`;
    } else if (v.type === 'book' && b) {
      const sec = v.sec === 'vocab' ? 'vocab' : 'quotes';
      crumbs.push({ label: '/' + b.slug, go: () => this.goView({ type: 'book', bookId: b.id, sec: 'quotes' }) });
      crumbs.push({ label: '/' + sec, go: () => this.goView({ type: 'book', bookId: b.id, sec }) });
      statusPath = `library › ${b.slug} › ${sec}`; summary = [b.author, ...b.tags].filter(Boolean).join(' · ');
      if (sec === 'quotes') {
        lines.push(header('', 'QUOTES', 'PAGE', 'THOUGHTS'));
        items.forEach((it, i) => lines.push(row(i, { id: it.q.id, pre: qn(b, it.q), main: '“' + it.q.text + '”', a: it.q.page ? 'p. ' + it.q.page : '', b: it.q.thoughts.length ? String(it.q.thoughts.length) : '·' })));
        if (insertAt && s.edit.isNew && s.edit.kind === 'quote') lines.push(newRow('quote', { pre: 'q' + String(b.quotes.length + 1).padStart(2, '0') }));
        if (!items.length && !insertAt) lines.push(note('no quotes yet — o to add one'));
      } else {
        lines.push(header('', 'VOCAB', '', '', '', 'ADDED'));
        items.forEach((it, i) => lines.push(row(i, { id: it.w.id, pre: it.w.word, main: it.w.def, d: fmtDay(it.w.at) })));
        if (insertAt && s.edit.isNew && s.edit.kind === 'vocabword') lines.push(newRow('vocabword', { sub: '· word, Enter' }));
        if (insertAt && s.edit.isNew && s.edit.kind === 'vocabdef') lines.push(newRow('vocabdef', { pre: s.edit.word, sub: '· definition' }));
        if (!items.length && !insertAt) lines.push(note('no words yet — o to add one'));
      }
    } else if (v.type === 'thread' && b && q) {
      crumbs.push({ label: '/' + b.slug, go: () => this.goView({ type: 'book', bookId: b.id, sec: 'quotes' }) });
      crumbs.push({ label: '/quotes', go: () => this.goView({ type: 'book', bookId: b.id, sec: 'quotes' }, b.quotes.indexOf(q)) });
      crumbs.push({ label: '/' + qn(b, q), go: () => {} });
      statusPath = `library › ${b.slug} › ${qn(b, q)}`; summary = `${b.title}${b.author ? ' · ' + b.author : ''}`;
      quote = { text: q.text, ref: `${b.slug}/${qn(b, q)}`, page: q.page ? 'p. ' + q.page : 'no page · :page <n>', count: `${q.thoughts.length} ${q.thoughts.length === 1 ? 'thought' : 'thoughts'}` };
      items.forEach((it, i) => lines.push(row(i, { id: it.t.id, pre: fmtTime(it.t.at), main: it.t.text })));
      if (insertAt && s.edit.isNew && s.edit.kind === 'thought') lines.push(newRow('thought', { pre: fmtTime(Date.now()), sub: '' }));
      if (!items.length && !insertAt) lines.push(note('no thoughts yet — a to write a line, o for long-form'));
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
    const modeLabel = s.mode === 'command' ? 'COMMAND' : s.long ? s.long.vmode.toUpperCase() : s.mode === 'search' ? 'SEARCH' : s.mode.toUpperCase();
    const cmdText = s.mode === 'command' ? ':' + s.cmd : s.mode === 'search' ? '/' + s.cmd : s.long ? (s.long.vmode === 'insert' ? '-- INSERT --  Esc → normal' : s.msg || (s.longText !== s.long.saved ? '[+] modified · :w writes · :wq writes and closes · :q! discards' : ':q closes')) : s.mode === 'insert' ? '-- INSERT --  Enter commits · Esc returns · [ links a tag' : s.mode === 'visual' ? '-- VISUAL LINE --  d delete · y yank · Esc' : s.msg || (s.search ? `/${s.search}  (Esc clears)` : '');
    const comps = s.mode === 'command' ? CMDS.filter(c => c[0].startsWith(s.cmd) && s.cmd.length > 0 || (!s.cmd && ['q', 'new book <title>', 'quote', 'def <word>', 'help'].includes(c[0]))).slice(0, 6).map((c, i) => ({ label: ':' + c[0], hint: c[1], bg: i === 0 && s.cmd ? 'var(--hl,#f3f1ec)' : 'transparent', prefix: c[0].replace(/<.*>/, '').trimEnd() + (c[0].includes('<') ? ' ' : ''), arg: c[0].includes('<') })) : [];
    const tq = this.tagQuery(), tagOpts = tq !== null ? this.tagOptions(tq).map((o, i) => ({ ...o, label: '[' + o.name + ']', hint: o.create ? 'new tag' : `${idx.get(o.name).refs.length} ${idx.get(o.name).refs.length === 1 ? 'place' : 'places'}`, bg: i === s.tagSel % Math.max(1, this.tagOptions(tq).length) ? 'var(--hl,#f3f1ec)' : 'transparent' })) : [];
    const hoverEntry = s.hover ? idx.get(s.hover.tag) : null;
    const hover = s.hover ? { ...s.hover, name: s.hover.tag, refs: hoverEntry ? hoverEntry.refs.slice(0, 8) : [], total: hoverEntry ? hoverEntry.refs.length : 0 } : null;
    const cursorIdx = s.focus === 'side' ? s.side : s.cur, navN = s.focus === 'side' ? this.sideList().length : items.length;
    const actions = [['new', 'new'], ['edit', 'edit'], ['del', 'delete'], ['undo', 'undo'], [':cmd', 'cmd'], ['?', 'help'], [s.theme === 'light' ? 'dark' : 'light', 'theme'], ['sidebar', 'sidebar']].map(([label, name]) => ({ label, name }));
    const cmdBtns = s.long && s.mode !== 'command' ? [['write', 'write'], ['write & close', 'keep'], ['close', 'close']] : s.mode === 'insert' ? [['done', 'done']] : s.mode === 'command' ? [['run', 'run'], ['cancel', 'cancel']] : s.mode === 'search' ? [['apply', 'apply'], ['cancel', 'cancel']] : s.mode === 'visual' ? [['delete', 'delete'], ['yank', 'yank'], ['cancel', 'cancel']] : s.search ? [['clear search', 'clear']] : [];
    return {
      th, sidebarOpen: s.sidebar, sideItems, tags, crumbs, summary, statusPath, isEmpty: v.type === 'empty', isThread: v.type === 'thread' && !!quote, quote: quote || {}, isWord: !!word, word: word || {}, showLines: !s.long && v.type !== 'empty' && v.type !== 'word', lines,
      longform: !!s.long, longNormal: !!s.long && s.long.vmode !== 'insert', longRef: this.longRef, longText: s.longText, onLongChange: e => this.setState({ longText: e.target.value }),
      showComp: comps.length > 0, comps, showTagPop: tagOpts.length > 0, tagOpts, showHelp: s.help, helpRows: HELP.map(([k, v]) => ({ k, v })), hover,
      store: s.archive ? (s.archiveState === 'saved' ? 'archive' : s.archiveState === 'error' ? 'archive!' : 'archive…') : 'local', storeTitle: s.archive || 'localStorage only (no dev server)',
      modeLabel, showcmd: (s.count + s.pending).replace(' ', '␣'), pos: `${Math.min(cursorIdx + 1, Math.max(navN, 1))},1  ${navN ? 'All' : '—'}`,
      cmdText, cmdColor: s.mode === 'command' || s.mode === 'search' ? 'var(--ink,#111)' : 'var(--muted,#8a877f)', cmdCursor: s.mode === 'command' || s.mode === 'search', cmdBtns, actions,
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
                  <div key={i} className={ln.idx === undefined ? 'row' : 'row clickable'} style={{ background: ln.bg, fontWeight: ln.weight }} onClick={() => this.clickRow(ln.idx)} onDoubleClick={() => this.dblRow(ln.idx)}>
                    <span className="row-num" style={{ color: ln.numColor }}>{ln.num}</span>
                    <span className="row-pre">{ln.pre}</span>
                    <span className="row-main" style={{ color: ln.mainColor }}>
                      {ln.editing && ln.fields ? ln.fields.map((f, j) => (
                        <React.Fragment key={j}>{j > 0 && <span className="row-sub"> — </span>}{f.text ? (f.active ? <>{f.text.slice(0, ln.ipos)}<span className="caret" />{f.text.slice(ln.ipos)}</> : f.text) : <><span className="ph">{f.ph}</span>{f.active && <span className="caret" />}</>}</React.Fragment>
                      )) : ln.editing ? <>{ln.main.slice(0, ln.ipos)}<span className="caret" />{ln.main.slice(ln.ipos)}</> : this.rich(ln.main)}
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
                <div className="long-label">long-form · {V.longNormal ? 'NORMAL · i a I A o O insert · h j k l w b 0 $ · x dd u · :w :wq :q' : 'INSERT · Esc → normal'}</div>
                <textarea ref={V.longRef} className={V.longNormal ? 'vnormal' : ''} value={V.longText} onChange={V.onLongChange} spellCheck={false} />
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
            <span>{V.cmdText}{V.cmdCursor && <span className="caret" />}</span>
            <span className="cmd-btns">{V.cmdBtns.map(([label, name]) => <span key={name} className="cmd-btn" onClick={stop(() => this.action(name))}>{label}</span>)}</span>
          </div>
        </div>
      </div>
    );
  }
}
