export const THEMES = {
  light: { bg: '#ffffff', ink: '#111111', muted: '#8a877f', faint: '#b5b2aa', line: '#e6e3dc', hl: '#f3f1ec', bar: '#f7f6f2' },
  dark: { bg: '#121212', ink: '#ffffff', muted: '#8f8f8f', faint: '#5c5c5c', line: '#2a2a2a', hl: '#1f1f1f', bar: '#181818' },
};
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
let uid = 1;
export const id = () => 'x' + (uid++) + Date.now().toString(36);
export const seed = () => [];
// "Life 3.0" -> life-3-0 ; "The Brothers Karamazov" -> brothers-karamazov ; unique within the library
export const slugOf = (title, taken = []) => {
  const base = String(title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '') || 'book';
  let out = base, n = 2; while (taken.includes(out)) out = base + '-' + n++; return out;
};
export const reslug = books => { books.forEach((b, i) => { b.slug = slugOf(b.title, books.slice(0, i).map(x => x.slug)); }); return books; };
// "Title - Author" / "Title — Author" typed as one line
export const splitTitle = text => { const m = /^(.+?)\s+[-—–]\s+(.+)$/.exec(text); return m ? [m[1].trim(), m[2].trim()] : [text, '']; };
// thoughts are a tree: each thought may hold replies in `thoughts`
export const flatThoughts = (q, f = [], depth = 0, list = q.thoughts) => { list.forEach(t => { f.push({ t, depth }); flatThoughts(q, f, depth + 1, t.thoughts || []); }); return f; };
export const countThoughts = q => flatThoughts(q).length;
export const findThought = (q, tid) => { let out = null; const walk = (list, parent) => list.forEach((t, i) => { if (t.id === tid) out = { t, list, i, parent }; else if (t.thoughts) walk(t.thoughts, t); }); walk(q.thoughts, null); return out; };
export const touched = b => Math.max(0, ...b.quotes.flatMap(q => flatThoughts(q).map(x => x.t.at)), ...b.vocab.map(v => v.at));
export const fmtDay = ts => { const d = new Date(ts); const days = (Date.now() - ts) / 864e5; return days < 7 ? DAYS[d.getDay()] : MONTHS[d.getMonth()]; };
export const fmtTime = ts => { const d = new Date(ts); return `${DAYS[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const CMDS = [['q', 'back / close'], ['new book <title>', 'creates it · "Title - Author" sets both'], ['quote', 'new quote here'], ['def <word>', 'new vocab word · definition on line 2'], ['page <n>', 'set page of quote'], ['tag #name', 'tag this book'], ['go #name', 'open tag view'], ['vocab', 'all words across books'], ['ai', 'look up word with openai'], ['author <name>', 'set author'], ['theme dark', ''], ['theme light', ''], ['set nu', 'toggle line numbers'], ['help', 'keys'], ['w', 'write archive now · editing: write the buffer'], ['reload', 'reload from the archive folder'], ['wq', 'editing: write & close'], ['q!', 'editing: discard & close'], ['reset', 'clear all data']];
export const HELP = [['h j k l', 'move · h back / l open · tree: l unfold · h fold'], ['Enter', 'open · leaf: edit'], ['i  c', 'edit in the buffer (normal mode)'], ['a  A  I', 'edit, insert at end · at start'], ['o', 'new item, insert mode · thread: sibling thought'], ['a', 'thread: reply to the thought under the cursor'], ['buffer', 'i a I A o O · h j k l w b e 0 ^ $ gg G · x dd dw cw D C S J'], ['buffer', 'text objects iw aw iW ip i( i[ i" … with v c d y'], ['buffer', 'v V visual (t tags the selection) · yy p u C-r · :w :wq :q :q!'], ['v', 'list: visual line'], ['dd  u', 'delete · undo'], ['yy  p', 'yank · paste as new item'], ['⌘c  ⌘v', 'copy line · paste'], ['gg  G', 'top · bottom'], ['/', 'search'], [':', 'command'], ['gx', 'follow first [link] in line'], ['r', 'word view: ask openai again'], ['[word]', 'tag · [some words](tag) tags a span'], ['C-w  C-u', 'insert: delete word / to start'], ['C-h  C-l', 'focus sidebar · main'], ['\\b  ␣ee', 'toggle sidebar'], ['Esc', 'normal']];
