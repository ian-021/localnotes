// The archive: every book is a folder of Markdown files, git-friendly and readable in Obsidian.
//
//   <ARCHIVE_DIR>/books/<slug>/book.md              frontmatter: id, title, author, tags, order
//   <ARCHIVE_DIR>/books/<slug>/quotes/<words>.md     frontmatter: id, page, order · body: "> quote" then "## thoughts" with "### <iso> {#id}" sections
//   <ARCHIVE_DIR>/books/<slug>/vocab/<word>.md       frontmatter: id, word, at, order · body: definition, then "## lookup" with a json block (AI cache)
//
// Used by vite.config.js (dev server API). The app is the only editor: it loads this at startup and writes on every change.
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';

const plain = s => /^[A-Za-z0-9][A-Za-z0-9 _.\-'’!?()&,]*$/.test(s) && !/\s$/.test(s) && !/^(true|false|null|\d+)$/.test(s);
const enc = v => Array.isArray(v) ? '[' + v.map(enc).join(', ') + ']' : typeof v === 'number' ? String(v) : plain(String(v)) ? String(v) : JSON.stringify(String(v));
const dec = v => { v = v.trim(); if (v.startsWith('"')) { try { return JSON.parse(v); } catch (e) { return v; } } if (v.startsWith('[')) { const inner = v.slice(1, -1).trim(); return inner ? inner.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(dec) : []; } return v; };
const front = obj => '---\n' + Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${enc(v)}`).join('\n') + '\n---\n';
const parseFront = text => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text); if (!m) return { meta: {}, body: text };
  const meta = {}; m[1].split(/\r?\n/).forEach(l => { const i = l.indexOf(':'); if (i > 0) meta[l.slice(0, i).trim()] = dec(l.slice(i + 1)); });
  return { meta, body: text.slice(m[0].length) };
};
const iso = ms => new Date(Number(ms) || 0).toISOString();
const ms = s => { const t = Date.parse(s); return isNaN(t) ? Date.now() : t; };
export const fileName = (text, fallback = 'untitled') => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '') || fallback;
const unique = (names, base) => { let n = base, i = 2; while (names.has(n)) n = `${base}-${i++}`; names.add(n); return n; };

// ---- serialize
const bookMd = (b, order) => front({ id: b.id, title: b.title, author: b.author, tags: b.tags.map(t => t.replace(/^#/, '')), order }) + `\n# ${b.title}\n${b.author ? `\n*${b.author}*\n` : ''}`;
const quoteMd = (q, order) => front({ id: q.id, page: q.page || undefined, order }) + '\n' + q.text.split('\n').map(l => '> ' + l).join('\n') + '\n' +
  (q.thoughts.length ? '\n## thoughts\n' + q.thoughts.map(t => `\n### ${iso(t.at)} {#${t.id}}\n${t.text}\n`).join('') : '');
const vocabMd = (w, order) => front({ id: w.id, word: w.word, at: iso(w.at), order }) + '\n' + w.def + '\n' + (w.ai ? '\n## lookup\n```json\n' + JSON.stringify(w.ai, null, 2) + '\n```\n' : '');

export const toFiles = books => {
  const files = new Map(), dirs = new Set();
  books.forEach((b, bi) => {
    const dir = path.posix.join('books', unique(dirs, fileName(b.slug || b.title, 'book')));
    files.set(dir + '/book.md', bookMd(b, bi + 1));
    const qn = new Set(); b.quotes.forEach((q, i) => files.set(`${dir}/quotes/${unique(qn, fileName(q.text.split(/\s+/).slice(0, 6).join(' '), 'quote'))}.md`, quoteMd(q, i + 1)));
    const vn = new Set(); b.vocab.forEach((w, i) => files.set(`${dir}/vocab/${unique(vn, fileName(w.word, 'word'))}.md`, vocabMd(w, i + 1)));
  });
  return files;
};

// ---- parse
const parseQuote = (text, id) => {
  const { meta, body } = parseFront(text);
  const [head, ...rest] = body.split(/^## thoughts\s*$/m);
  const qtext = head.split(/\r?\n/).filter(l => l.startsWith('>')).map(l => l.replace(/^>\s?/, '')).join('\n').trim();
  const thoughts = [];
  (rest.join('\n')).split(/^### /m).slice(1).forEach(chunk => {
    const nl = chunk.indexOf('\n'), header = chunk.slice(0, nl < 0 ? chunk.length : nl), t = chunk.slice(nl + 1).trim();
    const im = /\{#([^}]+)\}/.exec(header);
    thoughts.push({ id: im ? im[1] : id(), at: ms(header.replace(/\{#[^}]+\}/, '').trim()), text: t });
  });
  return { id: meta.id || id(), text: qtext, page: meta.page ? Number(meta.page) : null, thoughts, order: Number(meta.order) || 0 };
};
const parseVocab = (text, name, id) => {
  const { meta, body } = parseFront(text);
  const [def, lookup] = body.split(/^## lookup\s*$/m);
  let ai; if (lookup) { const jm = /```json\s*([\s\S]*?)```/.exec(lookup); if (jm) try { ai = JSON.parse(jm[1]); } catch (e) {} }
  return { id: meta.id || id(), word: meta.word || name, def: def.trim(), at: meta.at ? ms(meta.at) : Date.now(), ...(ai ? { ai } : {}), order: Number(meta.order) || 0 };
};
const byOrder = (a, b) => a.order - b.order || a._name.localeCompare(b._name);
const strip = o => { delete o.order; delete o._name; return o; };

export async function readArchive(root, id = () => 'v' + Math.random().toString(36).slice(2, 10)) {
  const base = path.join(root, 'books');
  if (!existsSync(base)) return null;
  const books = [];
  for (const ent of await fs.readdir(base, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(base, ent.name), bookFile = path.join(dir, 'book.md');
    if (!existsSync(bookFile)) continue;
    const { meta } = parseFront(await fs.readFile(bookFile, 'utf8'));
    const readAll = async (sub, fn) => { const d = path.join(dir, sub); if (!existsSync(d)) return []; const out = []; for (const f of await fs.readdir(d)) if (f.endsWith('.md')) out.push({ ...fn(await fs.readFile(path.join(d, f), 'utf8'), f.slice(0, -3)), _name: f }); return out.sort(byOrder).map(strip); };
    books.push({ id: meta.id || id(), slug: ent.name, title: meta.title || ent.name, author: meta.author || '', tags: (Array.isArray(meta.tags) ? meta.tags : meta.tags ? [meta.tags] : []).map(t => '#' + String(t).replace(/^#/, '')),
      quotes: await readAll('quotes', t => parseQuote(t, id)), vocab: await readAll('vocab', (t, n) => parseVocab(t, n, id)), order: Number(meta.order) || 0, _name: ent.name });
  }
  return books.sort(byOrder).map(strip);
}

export async function writeArchive(root, books) {
  const base = path.join(root, 'books'); await fs.mkdir(base, { recursive: true });
  const files = toFiles(books); let written = 0, deleted = 0;
  for (const [rel, content] of files) {
    const abs = path.join(root, rel); await fs.mkdir(path.dirname(abs), { recursive: true });
    let cur = null; try { cur = await fs.readFile(abs, 'utf8'); } catch (e) {}
    if (cur !== content) { await fs.writeFile(abs, content); written++; }
  }
  // remove .md files we no longer own, then empty dirs
  const walk = async d => { for (const ent of await fs.readdir(d, { withFileTypes: true })) { const p = path.join(d, ent.name); if (ent.isDirectory()) await walk(p); else if (ent.name.endsWith('.md') && !files.has(path.relative(root, p).split(path.sep).join('/'))) { await fs.unlink(p); deleted++; } } };
  await walk(base);
  const prune = async d => { for (const ent of await fs.readdir(d, { withFileTypes: true })) if (ent.isDirectory()) await prune(path.join(d, ent.name)); if (d !== base && (await fs.readdir(d)).length === 0) await fs.rmdir(d); };
  await prune(base);
  return { written, deleted, files: files.size };
}

// ---- vite plugin: GET /api/archive reads the folder, PUT writes it
export function archivePlugin(dir) {
  const root = path.resolve(dir || 'archive');
  const api = server => {
    server.middlewares.use(async (req, res, next) => {
      if (!req.url.startsWith('/api/archive')) return next();
      const json = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
      try {
        if (req.method === 'GET') return json(200, { dir: root, books: await readArchive(root) });
        if (req.method === 'PUT') { let body = ''; for await (const c of req) body += c; return json(200, { ok: true, ...(await writeArchive(root, JSON.parse(body))) }); }
        json(405, { error: 'GET or PUT' });
      } catch (e) { json(500, { error: String(e.message || e) }); }
    });
  };
  return { name: 'archive', configureServer(server) { api(server); server.config.logger.info(`[archive] ${root}`); }, configurePreviewServer(server) { api(server); } };
}
