# Architecture

How the plugin is built, what is stored where, and where it differs from the original spec (`branching-story-plugin-spec (1).md`). Keep this file current when structure or the data format changes.

## Idea in one paragraph

A story is a folder. Each turn (prompt + generated output) is one note with a `parent` link, so the story is a tree. Editing a prompt creates a sibling (a new *prompt version*), regenerating creates a sibling with the same prompt (a *regeneration*, `regen_of` set), continuing from any node starts or extends a *branch*. Everything else (children, "version 2 of 3", paths) is derived in memory from frontmatter and never written back. Creating a node writes exactly one new file, which is what keeps FolderSync conflicts away.

## Layout of code

```
src/core/      pure logic, no Obsidian imports, unit-tested
  ids.ts        node ids (YYMMDD-HHMM-xx), titles, wikilink <-> id
  yaml.ts       tiny YAML emitter for node frontmatter (parsing is Obsidian's)
  nodeDoc.ts    node note format: frontmatter fields, sections Prompt/Output/Reasoning/Summary/Keep in mind, parse/serialize, replaceSection
  tree.ts       NodeMeta + TreeIndex: parents, children, prompt versions, regenerations, paths, navigation, starred
  links.ts      wikilinks, link stripping, heading sections, frontmatter filtering, text of a linked note for the context
  storyDoc.ts   the story root note (_story.md): sections, lore property, per-story overrides, template
  context.ts    buildContext(): what is sent to the model, in order, with token estimate per part
  summary.ts    summary states (missing/valid/stale/locked/edited), summary prompt, compile-path text
  hash.ts       cyrb53 hash used for summary bookkeeping
  status.ts     displayStatus(): shows a long-stale "generating" node as "interrupted" (display only)
  reuse.ts      candidate prompts to reuse (continuations of other versions, other versions)
  tokens.ts     chars/4 token estimate
src/api/client.ts   OpenAI-compatible client: streaming via fetch with fallback to requestUrl, SSE parser, model list, error messages, reasoning/usage parsing
src/plugin/    everything that touches Obsidian
  main.ts       plugin class: events, settings load/save, per-device storage helpers, model validation, sidebar activation, status bar
  settings.ts   BSSettings, defaults, migration (settingsVersion), settings tab
  store.ts      StoryStore: keeps the TreeIndex in sync with the metadata cache; loads a node's frontmatter and sections
  generate.ts   GenerationController: loadStory(), prepare() (context + summaries), run() (create node, stream, write), failStale()
  summaries.ts  SummaryService: lazy, hash-checked summaries with progress/cancel
  commands.ts   command registration plus newNode/regenerate/editAndRegenerate flows
  actions.ts    navigation, star/label, compile path, copy prompt, reuse candidates, open in new tab
  menu.ts       "Story menu": every applicable action in one list (for mobile)
  modals.ts     prompt window (drafts, reuse buttons), name/confirm/choice/progress/text modals
  navbar.ts     navigation bar: CodeMirror block widget (editor) + post-processor (reading view)
  headerActions.ts  header buttons (phone gets a short set)
  sidebar.ts    sidebar view: path, continuations, bookmarks
  diagnostics.ts    "Test connection" report
tests/          vitest; tests/stubs/obsidian.ts stands in for the Obsidian package (vitest.config.ts aliases it)
scripts/        install-test.mjs, fake-llm.mjs, seed-test-story.mjs
.github/workflows/release.yml   tag -> build -> release assets for BRAT
```

## Data on disk

```
Stories/<Story name>/
  _story.md        root note
  nodes/<id> <title>.md
  Compiled/        output of "Compile path to note"
```

**Node id**: `YYMMDD-HHMM-xx` (local time, two random base-36 chars), permanent, equal to the file-name prefix; the title part may be renamed freely. `parent` is a quoted wikilink; the id is read from its text, so renames never break the tree.

**Node frontmatter**: `id`, `parent`, `regen_of`, `created` (local `YYYY-MM-DDTHH:mm:ss`), `status` (`generating` | `done` | `failed` | `stopped`), `provider`, `model`, `settings` {temperature, max_tokens, top_p}, `usage` {input_tokens, output_tokens, reasoning_tokens, cost}, `summary_hash` (hash of the Output the summary was written from), `summary_check` (hash of the summary text as the plugin wrote it, to notice hand edits), `summary_locked`, `starred`, `label`, `error`.

**Node body**: `## Prompt`, `## Output`, optional reasoning callout `> [!note]- Reasoning`, `## Summary`, `## Keep in mind`. Sections are found by exact heading; generated text that imitates a heading is defanged on write.

**Story root `_story.md`**: sections `## System prompt`, `## Lore`, `## Pinned details`; property `lore:` (list of links); optional overrides `provider`, `model`, `temperature`, `max_tokens`, `top_p`, `recent_turns`.

**Context sent for a new node** (`core/context.ts`): system prompt, lore (text plus linked notes), pinned details, reference notes (links from the last N prompts and from every ancestor's "Keep in mind"), keep-in-mind lists of all ancestors, story so far (summaries of turns older than N), the last N turns as user/assistant pairs, the new prompt. Links are replaced by plain names in everything the model sees. Linked notes are sent with their frontmatter (setting) minus ignored keys; a `[[Note#Heading]]` link sends only that section. `recent_turns` 0 means send everything (no summaries).

**Summaries**: made lazily before generating a child; only turns outside the recent window; hand-edited or locked summaries are never overwritten; discarded regenerations never cost a call.

**Per-device state** (`app.saveLocalStorage`, never synced): last active node per story, LM Studio base URL, running generations, copied prompt, unsent prompt drafts. **Plugin settings** (`data.json`) are per device too because the author does not sync `.obsidian`; the OpenRouter key is entered on each device (Obsidian secret storage when available).

## Deviations from the original spec

| Spec | Now | Why |
| --- | --- | --- |
| Statuses `generating/done/failed` | plus `stopped` (cancelled, partial text kept); `interrupted` is shown, never stored | Stop must keep text; late syncs |
| Any stale `generating` node is marked failed on load | only the device that started it marks it failed | A late sync could overwrite finished text |
| Last active node in the root note | per-device local storage | FolderSync conflicts |
| Linked notes: text only (unspecified) | frontmatter included, toggle + ignore list | Character profiles keep details there |
| Lore only via root note | also `[[links]]` in prompts and "Keep in mind", with the N-recent-turns rule | Author's workflow |
| No `summary_check` | added | Detect hand-edited summaries |
| Import from the author's DeepSeek export (stage 2) | dropped | Not needed |
| Header buttons in stage 2, mobile in stage 1 | header buttons in stage 1, mobile in stage 2 | Author's decision |
| (not in spec) | navigation bar, header buttons, story menu, phone layout, connection test, streaming Auto/Off, prompt drafts, copy prompt, reuse prompts, open in new tab, per-device LM Studio address | Found necessary through use |
| Reasoning on/off setting | the toggle means "ask OpenRouter for reasoning and keep it"; off sends nothing and discards reasoning text; `reasoning_tokens` recorded | Models differ; cost transparency |

Not built yet from the spec: "Regenerate with model", second summary tier, Canvas view. Other plans are in `docs/future-ideas.md`.

## Technical notes worth knowing

- **Navigation bar**: in the editor it is a CodeMirror 6 block widget placed right after the frontmatter (a `StateField`, refreshed by a `StateEffect` when the index changes); in reading view a markdown post-processor puts it into the first rendered section (the properties block is a section too, starting at line 0, so compare `lineStart` with the first content line). Layout styles are also set inline with `!important`.
- **Header buttons**: `view.addAction` per MarkdownView, set up again when the view's file changes kind (node, story root, other). Obsidian keeps these buttons after a plugin reload, so `HeaderActions.destroy()` runs on unload.
- **Streaming**: `fetch` streaming where allowed; on a TypeError (CORS, mixed content on mobile) the request is repeated through `requestUrl` without streaming. The setting `streaming: off` forces the plain path; Stop then answers at once and ignores the late reply. Summaries never stream.
- **Index**: built from the metadata cache on layout ready and once on the first `resolved` event, then updated per file (`changed`, `deleted`, `rename`); listeners are only told when something really changed.
- **Taps right after a menu**: on touch screens the end of the tap that picked a menu item can hit what appears below it. `markTransition()` / `inTransition()` in `main.ts` ignore sidebar-row and navigation-button clicks for 0.7 s after a menu, ribbon or command opened something.
- **Tests**: `vitest`; Obsidian is replaced by `tests/stubs/obsidian.ts`; the sidebar test runs in jsdom with small DOM helper polyfills. The UI itself (editor widget, header buttons, modals on Android) can only be checked by the author on real devices.

## What has been confirmed by the author on real devices

Reported working by the author: generation, regeneration, summaries and editing them, header buttons, navigation bar, BRAT installation and updates on PC and Android; the sidebar on PC after the 0.3.3 fix (the phone update was still to be confirmed); reusing prompts in the PC test vault; prompt drafts after 0.3.1. OpenRouter is the tested provider. LM Studio is untested on a real server (the author keeps it as a backup; the reasoning field name for LM Studio is unconfirmed).
