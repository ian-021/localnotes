// OpenAI lookup for a vocab word. The key comes from .env (VITE_OPENAI_API_KEY) and is
// bundled into the client, which is fine for this local-only app.
const KEY = import.meta.env.VITE_OPENAI_API_KEY;
const MODEL = import.meta.env.VITE_OPENAI_MODEL || 'gpt-5.4-mini';
// gpt-5.x / o-series are reasoning models: they reject temperature != 1 and take reasoning_effort instead.
const REASONING = /^(gpt-5|o\d)/.test(MODEL);
const tuning = () => REASONING ? { reasoning_effort: 'low' } : { temperature: 0.4 };
export const hasKey = () => !!KEY;
export const FIELDS = [['pos', 'part of speech'], ['ipa', 'pronunciation'], ['gloss', 'definition'], ['sentence', 'in a sentence'], ['etymology', 'etymology'], ['synonyms', 'synonyms'], ['tip', 'note']];

export async function lookup(word, note, book) {
  if (!KEY) throw new Error('no key · add VITE_OPENAI_API_KEY to .env and restart the dev server');
  const user = [
    `Word: "${word}"`,
    note ? `The reader's own note on it: "${note}"` : '',
    book ? `They met it in "${book.title}"${book.author ? ' by ' + book.author : ''}.` : '',
    'Return a JSON object with exactly these keys:',
    'pos (part of speech), ipa (IPA pronunciation), gloss (one-line dictionary definition),',
    'sentence (one simple example sentence that uses the word naturally),',
    'etymology (2–3 sentences: origin language and root, and how the meaning shifted),',
    'synonyms (array of 3–5 words), tip (one short mnemonic or usage note).',
  ].filter(Boolean).join('\n');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ model: MODEL, ...tuning(), response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: 'You are a concise, accurate lexicographer. Reply with JSON only.' },
      { role: 'user', content: user }] }),
  });
  if (!res.ok) { let m = res.statusText; try { m = (await res.json()).error?.message || m; } catch (e) {} throw new Error(`openai ${res.status}: ${m}`); }
  const data = await res.json(), text = data.choices?.[0]?.message?.content || '{}';
  const j = JSON.parse(text);
  return { pos: String(j.pos || ''), ipa: String(j.ipa || ''), gloss: String(j.gloss || ''), sentence: String(j.sentence || ''), etymology: String(j.etymology || ''), synonyms: Array.isArray(j.synonyms) ? j.synonyms.map(String) : String(j.synonyms || '').split(/,\s*/).filter(Boolean), tip: String(j.tip || ''), model: MODEL, at: Date.now() };
}
