# localnotes

A keyboard-driven, vim-flavoured reading journal: books → quotes → thoughts (and thoughts about thoughts, as deep as you like), plus a vocab list per book.
Everything lives in a **archive**: a folder of Markdown files you can commit and push with git.

## The archive

```
archive/
  books/
    life-3-0/
      book.md                      # id, title, author, tags
      quotes/
        intelligence-is-the.md     # "> quote", then "## thoughts": one "### <time> {#id}" section per thought; a reply is one level deeper (####)
      vocab/
        equanimity.md              # definition, then "## lookup" with the cached AI answer
```

The dev server (`bun run dev`) serves the app and a tiny file API (`archive.js`). The app loads the folder at startup and rewrites
the changed files after every edit, so the folder is always current. `ARCHIVE_DIR` in `.env` picks the folder (default `./archive`).
Point it at a dedicated git repo and commit there whenever you like:

```sh
cd archive && git init && git add -A && git commit -m "notes"
```

The app is the editor; it does not watch the folder. If you `git pull` new files, run `:reload`.

You can also drive git from inside the app. `:git <args>` runs `git <args>` in the archive folder through the dev server, as
you, with your ssh keys and config, so there is no login. Nothing opens: the result is one line in the status bar,
`git push · ok · main -> main` or `git commit · failed · <first error line>`. `:commit [message]` does `git add -A`, `git commit -m` (default message: `notes · <date>`) and `git push` in one go;
`:push`, `:pull` (reloads afterwards), `:status` and `:log` are shortcuts. Quotes group words: `:git commit -m "a message"`.
Git is run with prompts disabled and a 30 s timeout, so anything that would ask a question fails instead of hanging. Ids live in frontmatter so
links and threads survive renames. Without the dev server (a plain static build) the app falls back to `localStorage`; the
status bar says `archive` or `local`.

Implemented from the Claude Design artboard `Notes.dc.html`.

## Run

```sh
bun install
bun run dev      # http://localhost:5173
bun run build    # static bundle in dist/
```

## Keys

`h j k l` move within the focused pane · `Ctrl-h` / `Ctrl-l` switch between sidebar and main · `Enter` open (a thought: edit) · `i` / `c` edit in the buffer (NORMAL mode) · `a` / `A` edit, INSERT at end · `I` INSERT at start ·
`Enter` on a book in the sidebar unfolds it into `quotes` and `vocab`; `Enter` on one of those opens just that section in the main pane (`l` unfolds, `h` folds / goes back to the book) ·
`o` new item (INSERT mode) · in a thread `o` adds a thought after the one under the cursor and `a` replies beneath it (replies indent) · `v` visual line · `dd` delete · `u` undo · `yy` / `p` yank / paste (paste opens a buffer to check first) ·
`Cmd-c` / `Cmd-v` copy / paste · `gg` / `G` · `gx` follow first `[link]` on the line · `/` search · `:` command · `\b` or `␣ee` sidebar · `?` help.

Commands: `:q` `:new book <title>` `:quote` `:def <word>` `:page <n>` `:tag #name` `:go #name` `:vocab` `:ai` `:author <name>` `:theme dark|light` `:set nu` `:w` (write the archive now) `:reload` `:git <args>` `:commit [message]` `:push` `:pull` `:status` `:log` `:reset` (clears everything).

## All words

The `VOCAB › all words` entry in the sidebar (or `:vocab`) lists every word from every book in one alphabetical list, with the
book it came from and that book's tags. `Enter` on a word jumps to it inside its book; `i` edits the definition in place; `/` filters by
word, definition, book, or tag.

## Word detail (OpenAI)

`Enter` on any vocab word (in a book or in *all words*) opens the word: your note, where it came from, and an AI-filled
part of speech, pronunciation, definition, example sentence, etymology, synonyms, and a usage note. The answer is cached on
the word; `r` or `:ai` asks again. `q` / `h` goes back.

Setup: `cp .env.example .env`, put your key in `VITE_OPENAI_API_KEY`, restart `bun run dev`. The key is read by Vite at build
time and ends up in the client bundle, so only use this locally. `VITE_OPENAI_MODEL` overrides the model (default `gpt-5.4-mini`; reasoning models are sent `reasoning_effort: low`, older ones `temperature`).

## The buffer

There are two worlds: the lists (navigate, open, delete, yank) and the buffer (type). Every piece of text — a book, a quote,
a word, a thought, new or existing — is edited in the same vim-style buffer, and nothing is written until you say so.

- NORMAL: `i a I A o O` insert · `h j k l` (`j` / `k` walk wrapped lines) `w b e 0 ^ $ gg G` move · `x X s S D C J` ·
  operators `d c y` with any motion, doubled for the line (`dd cc yy`, also `dw cw d$ …`) or a text object (`ciw daw yi( di[ ci" dap …`) ·
  `p` / `P` paste · `u` undo · `Ctrl-r` redo ·
  `v` / `V` visual · `:` command. The cursor is a block on the current character.
- INSERT: type; `Esc` back to NORMAL. `[` opens tag completion. Mac shortcuts (`⌥←` `⌘⌫` …) work natively, plus `Ctrl-w` / `Ctrl-u`.
- VISUAL / V-LINE: motions extend the selection · text objects select (`viw vaw viW vip vi( va[ vi" …`) · `d` delete · `y` yank · `c` change · `t` tag the selection (wraps it in
  `[…](` and opens completion for the tag name) · `o` swap ends · `Esc`.
- `:w` writes, `:wq` (or `:x`) writes and closes, `:q` closes only if nothing changed since the last write, `:q!` discards.
  `:page <n>` works while editing an existing quote.

A new book is the exception: `o` in the library opens two inline fields, *title* then *author* (`Enter` after each, empty
author skips, `Title - Author` in the first fills both). Editing an existing book uses the buffer like everything else.

What the lines mean: a **book** is *title* on line 1 and *author* on line 2 (`Title - Author` on one line also works); a
**word** is the word on line 1 and its definition below; quotes and thoughts are free text. The short name in the sidebar is
derived from the title (`Life 3.0` → `life-3-0`) and follows title edits. `:def <word>` opens a word buffer with the word
already on line 1.

## Tags and links

Write `[word]` inside any title, quote, thought, or definition to tag it with that word. To tag a span with a different
name, write `[the children of our minds](ai)`: the span shows as the link and the tag name stays out of the way — it appears
only when the mouse is over the link or the row is under the cursor. In the buffer the span is tinted and the `(ai)` part
takes no room in the line: it floats as a small label above the span, shown while the cursor is inside the span or the
mouse is over it. Moving the cursor through the `(ai)` characters walks through that label. Typing `[` or `](` in insert mode opens a completion popup with every
known tag; in visual mode `t` wraps the selection and opens the same popup. Links render in `#9E9EFF`; hover one to see
everywhere that tag appears, click it to open the tag view. A book's `#tag` and a `[tag]` in text are the same tag.

## Mouse

Everything is reachable by mouse: click rows, books, tags, crumbs, and popup entries; double-click a row to open or edit
it; the status bar has new / edit / del / undo / :cmd / ? / theme / sidebar actions, and the command line shows
write / write & close / close buttons while a buffer is open.
