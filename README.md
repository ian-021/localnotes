# localnotes

A keyboard-driven, vim-flavoured reading journal: books → quotes → thoughts, plus a vocab list per book.
Everything lives in a **archive**: a folder of Markdown files you can commit and push with git.

## The archive

```
archive/
  books/
    life-3-0/
      book.md                      # id, title, author, tags
      quotes/
        intelligence-is-the.md     # "> quote", then "## thoughts" with one "### <time> {#id}" section each
      vocab/
        equanimity.md              # definition, then "## lookup" with the cached AI answer
```

The dev server (`bun run dev`) serves the app and a tiny file API (`archive.js`). The app loads the folder at startup and rewrites
the changed files after every edit, so the folder is always current. `ARCHIVE_DIR` in `.env` picks the folder (default `./archive`).
Point it at a dedicated git repo and commit there whenever you like:

```sh
cd archive && git init && git add -A && git commit -m "notes"
```

The app is the editor; it does not watch the folder. If you `git pull` new files, run `:reload`. Ids live in frontmatter so
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

`h j k l` move within the focused pane · `Ctrl-h` / `Ctrl-l` switch between sidebar and main · `Enter` open/edit · `i` / `A` edit line with caret at end · `I` edit line with caret at start ·
`Enter` on a book in the sidebar unfolds it into `quotes` and `vocab`; `Enter` on one of those opens just that section in the main pane (`l` unfolds, `h` folds / goes back to the book) ·
`a` new thought line · `o` new item (long-form in a thread) · `v` visual line · `dd` delete · `u` undo · `yy` / `p` yank / paste ·
`Cmd-c` / `Cmd-v` copy / paste · `gg` / `G` · `gx` follow first `[link]` on the line · `/` search · `:` command · `\b` or `␣ee` sidebar · `?` help.

Commands: `:q` `:new book <title>` `:quote` `:def <word>` `:page <n>` `:tag #name` `:go #name` `:vocab` `:ai` `:author <name>` `:theme dark|light` `:set nu` `:w` (write the archive now) `:reload` `:reset` (clears everything).

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

## Editing shortcuts (insert mode and the command line)

Mac: `⌥←` / `⌥→` word left / right · `⌘←` / `⌘→` line start / end · `⌥⌫` delete word back · `⌘⌫` delete to line start ·
`⌥fn⌫` delete word forward · `⌘fn⌫` delete to line end. Vim / emacs: `Ctrl-w` delete word back · `Ctrl-u` delete to line
start · `Ctrl-a` / `Ctrl-e` line start / end · `Ctrl-k` delete to line end. The long-form editor gets the Mac ones natively
and adds `Ctrl-w` / `Ctrl-u`.

## New book

`o` in the library opens two fields, *title* then *author*: type the title, `Enter`, type the author, `Enter` (or `Enter` on an
empty author to skip). Typing `Title - Author` in the first field fills both. The short name in the sidebar is derived from the
title (`Life 3.0` → `life-3-0`) and follows title edits.

## Long-form editor

`o` in a thread opens a long-form thought in a modal, vim-like editor. It opens in INSERT mode; `Esc` returns to NORMAL mode
without leaving. In NORMAL: `i a I A o O` insert, `h j k l w b e 0 ^ $ gg G` move, `x` / `dd` delete, `u` undo, `:` command.
`:w` writes, `:wq` (or `:x`) writes and closes, `:q` closes only if nothing changed since the last write, `:q!` discards.

## Tags and links

Write `[word]` inside any title, quote, thought, or definition to tag it. Typing `[` in insert mode opens a completion
popup with every known tag. Links render in `#9E9EFF`; hover one to see everywhere that tag appears, click it to open the
tag view. A book's `#tag` and a `[tag]` in text are the same tag.

## Mouse

Everything is reachable by mouse: click rows, books, tags, crumbs, and popup entries; double-click a row to open or edit
it; the status bar has new / edit / del / undo / :cmd / ? / theme / sidebar actions, and the command line shows
done / cancel / keep buttons for the current mode.
