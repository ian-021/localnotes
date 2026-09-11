# localnotes: keys and how to use it

localnotes is a reading journal you drive from the keyboard, vim style. The data is a tree:

```
library
  book            title, author, #tags
    quotes        a passage from the book, with an optional page
      thoughts    what you think about the quote
        replies   thoughts about a thought, nested as deep as you like
    vocab         words you looked up, with a definition (and an optional AI lookup)
```

Everything is saved to a folder of Markdown files (the archive) after every change, so there is no "save" step for the
journal itself. The only thing you have to write explicitly is the buffer (see below).

## Two worlds: lists and the buffer

The app has two kinds of screen and the same key can mean different things in each:

- **Lists.** The sidebar and the main pane show rows (books, quotes, thoughts, words). Here you navigate, open, delete,
  yank and paste rows. This is where you spend most of your time.
- **The buffer.** Whenever you create or edit any piece of text, a modal vim-style editor opens. It has NORMAL, INSERT
  and VISUAL modes, motions, operators, text objects, undo and redo. Nothing is written until you say `:w` or `:wq`.

The status bar at the bottom always shows the current mode, and `?` opens the built-in key list at any time.

## Getting around the lists

| Key | Action |
| --- | --- |
| `j` / `k` (or arrows) | move down / up. A count works: `3j` |
| `h` | go back one level (thread → book → library) |
| `l` or `Enter` | open the row under the cursor |
| `gg` / `G` | first / last row |
| `Ctrl-h` / `Ctrl-l` | move focus to the sidebar / main pane |
| `\b` or `Space e e` | show or hide the sidebar |
| `q` | go back (same as `h`) |
| `Esc` | clear pending keys, counts, search filter and messages |
| `?` | toggle help |

**The sidebar** lists your books. `Enter` (or `l`) on a book unfolds it into `quotes` and `vocab`; `Enter` on one of
those opens just that section in the main pane. `h` folds the book again or jumps back to it. `Enter` on `all words`
opens the vocabulary of every book.

**Opening things in the main pane.** `Enter` on a book opens its quotes. `Enter` on a quote opens its thread (the
quote and every thought under it). `Enter` on a word opens the word view. `Enter` on a thought edits it in the buffer.

## Creating and editing

| Key | Where | Action |
| --- | --- | --- |
| `o` (or `O`) | library | new book |
| `o` | book, quotes section | new quote |
| `o` | book, vocab section | new word |
| `o` | thread | new thought, placed right after the one under the cursor |
| `a` | thread | **reply** to the thought under the cursor (nested one level deeper) |
| `Enter` | thought | edit it |
| `i` or `c` | any row | edit the row in the buffer, starting in NORMAL mode |
| `a` or `A` | any row except in a thread | edit, INSERT mode with the cursor at the end |
| `I` | any row | edit, INSERT mode with the cursor at the start |

New items open the buffer in INSERT mode so you can type straight away. Editing an existing item with `i` or `c` opens
it in NORMAL mode so you can move around first.

### How to reply to a thought

1. Open a quote's thread with `Enter` on the quote.
2. Move the cursor onto the thought you want to answer.
3. Press `a`. The buffer opens, empty, in INSERT mode.
4. Type your reply, `Esc`, then `:wq`.

The reply appears indented under its parent. You can reply to a reply the same way. `o` on any thought adds a sibling
after it instead of a child. In the archive a reply is one heading level deeper (`###` → `####` → `#####`).

### What the lines in the buffer mean

The buffer is plain text, and the kind of item decides how it is read on write:

- **book**: line 1 is the title, line 2 the author. `Title - Author` on a single line also works.
- **word**: line 1 is the word, the definition is everything below it. `:def <word>` opens the buffer with the word already
  on line 1.
- **quote** and **thought**: free text, as many lines as you like.

The short name of a book in the sidebar (`Life 3.0` → `life-3-0`) comes from the title and follows title edits.

## Deleting, undoing, yanking, pasting (lists)

| Key | Action |
| --- | --- |
| `dd` | delete the row under the cursor (a book deletes its quotes and vocab too) |
| `v` / `V` | visual line mode: extend with `j` / `k`, then `d` or `x` to delete, `y` to yank, `Esc` to cancel |
| `u` | undo the last change (repeatable) |
| `yy` | yank the row to the clipboard |
| `p` / `P` | paste the clipboard as a new item. It opens in the buffer in NORMAL mode so you can check it before `:wq` |
| `Cmd-c` / `Cmd-v` | same as `yy` / `p`, using the system clipboard directly |

The sidebar is read-only for deletion: delete books from the library view in the main pane.

## Search and commands

- `/` starts a search. The list filters as you type. `Enter` keeps the filter, `Esc` clears it. `n` reminds you what
  the current filter is.
- `:` opens the command line. `Tab` completes a command name. `Enter` runs it, `Esc` cancels.
- In both, `Ctrl-w` (or `Alt-Backspace`) deletes the last word and `Ctrl-u` (or `Cmd-Backspace`) clears the line.

| Command | Action |
| --- | --- |
| `:q` | go back / close |
| `:new book <title>` | create a book. `Title - Author` sets both. Without a title, opens the buffer |
| `:quote` | new quote in the open book (opens the buffer). `:quote <text>` adds it directly |
| `:def <word>` | new vocab word in the open book, with the word on line 1 |
| `:page <n>` | set the page of the quote under the cursor (or the open thread). No number clears it |
| `:tag #name` | toggle a tag on the current book |
| `:go #name` | open the tag view for that tag |
| `:vocab` | every word across all books |
| `:ai` | look the word under the cursor up with OpenAI |
| `:author <name>` | set the author of the current book |
| `:theme dark` / `:theme light` | switch theme (`:theme` alone toggles) |
| `:set nu` | toggle line numbers |
| `:w` | write the archive to disk now |
| `:reload` | reload the archive folder (after a `git pull`, for instance) |
| `:reset` | clear everything (`u` undoes it) |
| `:help` | same as `?` |

## The buffer (vim mode)

Every piece of text is edited in the same buffer. The cursor is a block on the current character in NORMAL mode and a
blinking bar in INSERT mode. The title line above the text says what you are editing.

### Leaving the buffer

| Command | Action |
| --- | --- |
| `:w` | write (save the text to the item; the buffer stays open) |
| `:wq` or `:x` | write and close |
| `:q` | close, but only if nothing changed since the last write |
| `:q!` | discard changes and close |
| `:page <n>` | while editing an existing quote, set its page |

Writing an empty buffer discards the item ("discarded (empty)"). The command line also shows write / write & close /
close buttons for the mouse.

### NORMAL mode

| Keys | Action |
| --- | --- |
| `i` / `a` | insert before / after the cursor |
| `I` / `A` | insert at line start / end |
| `o` / `O` | open a new line below / above |
| `Esc` | in INSERT: back to NORMAL |
| `h j k l` | move (`j` / `k` walk wrapped screen lines, like `gj` / `gk`) |
| `w` / `b` / `e` | word forward / back / to end of word |
| `0` / `^` / `$` | line start / first non-blank / line end |
| `gg` / `G` | top / bottom |
| `Enter` | first non-blank of the next line |
| `x` / `X` | delete the character under / before the cursor |
| `s` / `S` | change character / change whole line |
| `D` / `C` | delete / change to end of line |
| `J` | join with the next line |
| `dd` / `cc` / `yy` (`Y`) | delete / change / yank the line |
| `d` `c` `y` + motion | operator with any motion: `dw` `cw` `d$` `y0` `dG` `dgg` `dj` ... |
| `d` `c` `y` + text object | `diw` `daw` `ciw` `dap` `yi(` `di[` `ci"` `da{` ... |
| `p` / `P` | paste after / before the cursor (from the system clipboard) |
| `u` / `Ctrl-r` | undo / redo |
| `v` / `V` | character / line visual mode |
| `:` | command line |
| `?` | help |

Text objects: `iw` `aw` (word), `iW` `aW` (WORD), `ip` `ap` (paragraph), and `i` / `a` with any of `( ) b [ ] { } B < > " ' \``.

### INSERT mode

Type. `Esc` returns to NORMAL. Arrow keys, `Home` and `End` move. Mac shortcuts work natively (`Alt-Left/Right` word,
`Cmd-Left/Right` line, `Alt-Backspace` delete word, `Cmd-Backspace` delete to line start), plus `Ctrl-w` (delete word
back) and `Ctrl-u` (delete to line start). `Cmd-v` pastes.

Typing `[` opens tag completion (see Tags). `Tab`, arrows or `Ctrl-n` / `Ctrl-p` move through the list, `Enter` accepts,
`Esc` closes the popup.

### VISUAL and V-LINE modes

| Keys | Action |
| --- | --- |
| motions | extend the selection (`w`, `$`, `j`, `G` ...) |
| `iw` `aw` `ip` `i(` `a"` ... | select a text object (`viw`, `vip`, `va(`) |
| `d` / `x` | delete |
| `y` | yank |
| `c` / `s` | change (delete and enter INSERT) |
| `t` | tag the selection: wraps it in `[...](` and opens completion for the tag name |
| `o` | jump to the other end of the selection |
| `v` / `V` | switch mode or leave |
| `Esc` | back to NORMAL |

## Tags and links

- Write `[word]` inside any title, quote, thought or definition to tag it with that word.
- Write `[some words](tag)` to tag a span with a different name. In rows only the span shows as a link; the tag name
  appears when the mouse is over it or the row is under the cursor. In the buffer the span is tinted and the `(tag)`
  part floats as a small label above it while the cursor is inside the span.
- Typing `[` or `](` in INSERT mode opens a completion popup with every known tag. In visual mode `t` wraps the selection
  and opens the same popup.
- A book's `#tag` (set with `:tag #name`) and a `[tag]` in text are the same tag.
- `gx` on a row follows the first link in it and opens the tag view: every place that tag appears. `Enter` on an entry
  jumps there; `q` or `h` goes back to where you came from. Hovering a link with the mouse shows the same list.

## Words and the AI lookup

Inside a book, `o` in the vocab section (or `:def <word>`) creates a word: word on line 1, definition below. `Enter` on
a word opens the word view. If an OpenAI key is configured (see the README), the view asks for pronunciation, meaning,
synonyms and examples and caches the answer in the archive. `r` or `:ai` asks again. `q` or `h` goes back.

## Saving and the archive

The status bar says `archive` when the dev server is writing your Markdown folder, `archive…` while a write is pending,
`archive!` if a write failed, and `local` when the app is running as a static build with `localStorage` only.

With the archive, every change is written within half a second. `:w` forces a write now. The app does not watch the
folder, so after pulling new files with git run `:reload`.

## Mouse

Everything is also reachable with the mouse: click rows, books, tags, crumbs and popup entries; double-click a row to
open or edit it; the status bar has new / edit / del / undo / :cmd / ? / theme / sidebar actions.

## A typical session

1. `bun run dev`, open the app.
2. `o` in the library, type `Deep Work - Cal Newport`, `Esc`, `:wq`.
3. `Enter` on the book, `o`, paste or type a quote, `Esc`, `:wq`. `:page 42` sets the page.
4. `Enter` on the quote to open its thread. `o`, type a thought, `Esc`, `:wq`.
5. Put the cursor on that thought and press `a` to reply to it. Type, `Esc`, `:wq`.
6. `h` to go back to the quotes, `Ctrl-h` to the sidebar, `l` to unfold the book, `j` `Enter` to open its vocab.
7. `:def equanimity`, type the definition on line 2, `Esc`, `:wq`. `Enter` on the word, then `:ai` to look it up.
8. Everything is already in `archive/`. Commit it there whenever you like.
