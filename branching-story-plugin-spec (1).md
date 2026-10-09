# Branching Story Plugin: Handoff Spec

2026-10-08

## Purpose and context

Build an Obsidian plugin for iterative story generation: the author writes a short brief, a model expands it into prose, and the author keeps editing prompts, regenerating and branching, with every attempt kept as a note in the vault. It is for personal use only, so it supports exactly two providers (LM Studio and OpenRouter) and nothing else.

How the author works, and why existing tools fall short:

- **Brief in, prose out.** This is not roleplay. There are no characters to play, no personas and no dice. The author reads the output, then writes the next part.
- **Heavy iteration.** A single prompt is often edited 10 to 20 times. The author also goes back several turns, changes one detail, and starts a new branch. Some story versions can be saved/exporded as snapshots. 
- **Cheap and fast models.** Prose quality of the generating model matters less than low cost, speed and few restrictions, so the author switches models freely.
- **Lore already lives in Obsidian.** Story lore, character profiles and drafts are notes in the same vault. The plugin should read them (read-only) instead of duplicating them into a lorebook.
- **Phone and PC.** The vault syncs between devices, and the workflow should work on both.

Chat plugins already tried (ChatGPT MD, AI Chat as Markdown, Copilot Quick Chat) keep one timeline or only the latest iteration. None keeps an editable tree of prompt versions, regenerations and branches as notes.

The data model is borrowed from a vault the author already has: a DeepSeek chat with hundreds of branches, exported as one note per message with frontmatter fields such as message_id, parent_id, prompt_version and reply_alternative. The new format is a simplified version of that structure.

## Goals and non-goals

The plugin must make editing, regenerating and branching cheap and lossless, while keeping every story as plain markdown notes that survive without the plugin.

**Goals**

1. One note per turn (prompt, output, optional reasoning, summary), linked into a tree.
2. Editing a prompt creates a new sibling, regenerating creates a sibling with the same prompt, and branching means continuing from any node.
3. Context is built from summaries of earlier turns, the last few turns verbatim, linked lore notes and pinned details, so token cost stays reasonable on long stories.
4. Works on desktop and mobile. The one exception is LM Studio, which is reachable only from the machine it runs on (or the local network).
5. Branches can be starred and labelled, so a long branch starting at prompt version 7 or 19 is easy to find again.
6. All data is markdown plus frontmatter. Uninstalling the plugin loses nothing.

**Non-goals**

- Providers other than LM Studio and OpenRouter.
- Roleplay features, personas, dice or character cards.
- Writing to lore notes (the plugin is read-only on them).
- Agents, tool calling, embeddings or vault search.
- Merging branches, or multi-user editing.

## Core model

A story is a tree of nodes, and each node is one note that stores only a pointer to its parent.

- **Story:** a folder with a root note (`_story.md`) holding the system prompt, lore links, pinned details, default model settings and, optionally, the last active node.
- **Node:** one turn, meaning one prompt and the output generated for it, plus optional reasoning, a summary and a "keep in mind" list.
- **Parent:** each node names its parent. The first node has none. Parent pointers are the only structure stored.
- **Regeneration:** a node whose `regen_of` field names the node it regenerates. It has the same parent and the same prompt text.
- **Prompt version:** a sibling that has no `regen_of`. Siblings under one parent are ordered by creation time, which gives "version 7 of 20".
- **Branch:** continuing from any node that already has children. No special object is needed.
- **Active path:** the chain of parents from a node up to the root. This chain, and nothing else, defines the context sent to the model.

Everything else is derived by an in-memory index built from frontmatter (via Obsidian's metadata cache) and never written back:

| Relation | How it is derived |
| --- | --- |
| Up / previous message | The node's `parent` |
| Children (next messages) | Notes whose `parent` is this node |
| Previous / next prompt version | Neighbouring siblings without `regen_of`, ordered by `created` |
| Previous / next regeneration | Siblings whose `regen_of` names the same original node (plus that original itself), ordered by `created` |
| Version counters ("5 of 20") | Position in those sibling lists |

Because links point only backward, creating a new node writes exactly one new file. No older note has to change when a sibling is added.

## Files, naming and frontmatter

Every node file is named `<id> <title>.md`, where the id is permanent and the title is free text the author can rename at any time.

```
Stories/<Story name>/
  _story.md                       root note: config, lore links, pinned details
  nodes/
    261008-1432-k7 Koss wakes at dawn.md
    261008-1440-p2 Koss wakes at dawn.md      (a regeneration, same title is fine)
    261009-0915-m4 Atka visits.md
```

**Naming convention**

- **Id:** `YYMMDD-HHMM-xx`, where `xx` is two random base-36 characters. It sorts chronologically, is readable at a glance, and avoids the collisions that sequential numbers would cause when the phone and the PC each create a node while offline.
- **Title:** the first five or so words of the prompt, generated automatically, capped at about 60 characters, with characters that are illegal in filenames removed.
- **Renaming:** the author may change the title part to mark a branch (for example `Koss recovers`). The plugin identifies a node by its `id` frontmatter field, which equals the filename prefix, and resolves `parent` by that prefix, so a rename never breaks the tree. Obsidian's own link updating also rewrites the wikilinks.

**Frontmatter**

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Permanent id, equal to the filename prefix |
| `parent` | yes (empty on the first node) | Wikilink to the parent node, written in quotes, e.g. `"[[261008-1432-k7 Koss wakes at dawn]]"` |
| `regen_of` | no | Wikilink to the node this one regenerates. Absent for original prompt versions |
| `created` | yes | Creation timestamp, used for ordering siblings |
| `status` | yes | `generating`, `done` or `failed` |
| `provider`, `model` | yes after generation | What produced the output (`lmstudio` or `openrouter`, plus the model slug) |
| `settings` | no | Temperature, max tokens and other parameters actually used |
| `usage` | no | Input and output tokens, and cost when the provider reports it |
| `summary_hash` | no | Hash of the Output text the current summary was written from |
| `summary_locked` | no | `true` if the author edited the summary by hand, so it is never overwritten |
| `starred` | no | `true` for bookmarked nodes |
| `label` | no | Free-text branch label shown in the bookmarks list |
| `error` | no | Raw error text when `status` is `failed` |

The regenerations of one prompt are the original node plus every sibling whose `regen_of` names it.

Writing `parent` as a quoted wikilink also makes Obsidian's Backlinks pane list a node's children, which works as a fallback on a device where the plugin is not running.

**Body layout**

```markdown
## Prompt
The author's text for this turn.

## Output
The generated prose.

> [!note]- Reasoning
> Reasoning text, only if the provider returned it. Never sent back as context.

## Summary
Short summary of the Output, written by the plugin (editable).

## Keep in mind
- Details that must keep appearing on this branch (optional, written by the author).
```

The plugin finds each part by its heading. The author can edit any part by hand, including the Output.

## Interface and commands

The notes themselves are the interface: every action is a command that works from the node note that is currently open, and every command is also reachable from a button, because the mobile app has no hotkeys.

**Generation**

- **New node from here:** opens a modal with a text field for the next prompt, creates a child of the open node, and generates the output into it.
- **Regenerate:** creates a sibling with `regen_of` set, the same prompt text and the same context chain as the open node.
- **Edit prompt and regenerate:** opens the same modal pre-filled with the current prompt and creates a new sibling version under the same parent.
- **Regenerate with model:** like Regenerate, but asks which model to use. Useful for comparing models on the same prompt.
- **Stop generation:** cancels the request and keeps whatever text has arrived, with `status` set accordingly.

**Navigation** (all assignable to hotkeys)

- Up (to the parent), and down (to the children; if there are several, a picker lists each child by its label or the start of its prompt).
- Previous and next prompt version.
- Previous and next regeneration.
- Go to the story's last active node.

**Context and summaries**

- **Preview context:** shows the exact assembled input and a token estimate without sending anything.
- **Regenerate summary:** forces a new summary for the open node.

**Branches and output**

- **Toggle star / set label** on the open node.
- **Compile path to note:** concatenates the Output sections along the active path into one new note, for saving a finished snapshot.

**Views and buttons**

- A small row of action buttons in the note header (Obsidian's view actions) for the commands above.
- From stage 1: a sidebar view showing the current path with version and regeneration counters ("version 7 of 20", "regeneration 2 of 3") and the list of starred nodes for the story.

## Context assembly and summaries

Older turns are sent as short summaries and only the most recent turns are sent in full, which keeps token cost roughly linear in story length while keeping the story on track.

**What is sent for a new node, in order**

1. **System prompt** from the story's root note.
2. **Lore:** the full text of every note linked in the root note's `lore` list, resolved at send time and read-only.
3. **Pinned details:** the root note's "Pinned details" section, always included.
4. **Branch details:** the "Keep in mind" items of every ancestor, so a detail set on one branch is inherited by everything below it on that branch and by no other branch.
5. **Story so far:** the `## Summary` of each ancestor, oldest first, excluding the most recent N turns.
6. **Recent turns:** the last N ancestors as full prompt and output pairs (user and assistant messages). N is a setting, default 2.
7. **The new prompt** as the final user message.

Reasoning text stored in a node is never included, in context or in summaries.

**Summaries**

- Each node's summary covers only that node's Output, never earlier summaries, so errors cannot compound along the chain.
- Summaries are generated lazily. Before generating a child of node P, the plugin checks every ancestor in the summarized part. If a summary is missing, or its `summary_hash` no longer matches the hash of the current Output text, it generates a new one. Discarded regenerations therefore never cost a summary call, and hand-edited outputs are picked up automatically.
- A summary is written into the note it describes (the `## Summary` section) together with `summary_hash`. If the author edits a summary by hand, the plugin sets `summary_locked: true` and never overwrites it.
- Summary prompt: summarize this passage in about 60 to 120 words, keeping names, events, changes in state and unresolved threads. A cheap, fast model is enough; the summary model is a separate setting.
- On a long branch with no summaries yet (for example an imported one), show progress and let the author cancel, since this can mean many calls.

**Budget**

Show a token estimate (characters divided by 4 is acceptable at first) broken down by part, and a `max_context_tokens` setting. If the estimate exceeds it, show the breakdown and ask before sending. A second summary tier that condenses old summaries is a later option, not part of the first build.

## Providers and settings

Both providers speak the OpenAI-compatible chat completions protocol, so one client with a configurable base URL covers both.

| | LM Studio | OpenRouter |
| --- | --- | --- |
| Base URL | `http://localhost:1234/v1` by default, editable | `https://openrouter.ai/api/v1` |
| Key | None | API key |
| Model list | `GET /v1/models` | `GET /api/v1/models` (public) |
| Reachable from phone | Only if the server is exposed on the local network | Yes |

**Model selection.** Each provider setting has a "Fetch models" button that loads the model list, with a search box and a favorites list pinned to the top. The existing plugins the author tried lack this, which forced copying slugs from the website by hand. Validate the chosen slug against the fetched list and show a clear error naming the model when it is unknown. A typo in a model slug caused only an opaque "No output generated" error in another plugin, and this should not happen here.

**Reasoning.** If the provider returns reasoning text, store it in the collapsed Reasoning callout. The field names differ by provider (OpenRouter and LM Studio use different ones, to be verified against their documentation), so isolate this in the provider layer. Reasoning on or off is a setting.

**Settings**

- Default provider and model for generation.
- Summary provider and model (separate, normally a cheaper model).
- Temperature, max tokens and optional top_p.
- Number of recent turns sent in full (N), and `max_context_tokens`.
- Stories root folder.
- Per-story overrides of the above in the root note's frontmatter. A single regeneration can override the model with the "Regenerate with model" command, and the model actually used is recorded in that node.

**API key storage.** Use Obsidian's secret storage if available, otherwise the plugin's own data. Never write the key into the vault's notes.

## Bookmarks and branch labels

Any node can be starred and given a label, so a big branch that starts at prompt version 7 (or 19) of a turn can be found again without remembering where it was.

- **Storage:** `starred: true` and an optional `label` in the node's frontmatter. Both are plain fields, so they also work with Obsidian's search, Bases or Dataview.
- **Set from:** the "Toggle star / set label" command, a header button, and the sidebar list.
- **Bookmarks list:** a section of the sidebar view that shows all starred nodes of the open story. Each row shows the label (or the title if there is none), its version counter (for example "version 7 of 20"), the number of descendant nodes (so a big branch is visible at a glance), and opens the node on click. Sort by creation time or by descendant count.
- **Renaming is optional:** the author may also rename the title part of the filename to mark a branch. The id prefix stays, so nothing breaks (see the naming convention above).
- **Independent of Obsidian's core Bookmarks plugin,** which can still be used on the same notes if wanted.

## Sync, mobile and error handling

The design avoids sync conflicts by making almost every action a write to one new file, and it must load and run on mobile.

**Sync**

- Creating a node writes one new file. The only writes to existing notes are a missing summary written into the ancestor it describes (idempotent, because it is derived from that note's own text) and, optionally, the active node recorded in the root note.
- Ids include a timestamp and random characters, so two devices creating nodes offline cannot collide.
- Store the story's last active node in the root note if position should sync between devices, or in local plugin data if conflicts become a problem. Start with the root note.

**Mobile**

- Use only the Obsidian API (no Node or Electron modules) and set `isDesktopOnly: false`.
- Streaming: use `fetch` streaming where it works. On mobile it is unverified, so fall back to non-streaming `requestUrl` if streaming fails. Do not write to the file on every token. Update the open editor at a throttled interval (about once a second at most) or write once on completion.
- LM Studio is not reachable from the phone unless exposed on the local network. Detect this and show a clear "provider unreachable" message instead of a generic failure.

**Errors**

- Show the raw HTTP status and the provider's error message in a notice and in the console. A vague message such as "No output generated" is the failure to avoid.
- When a request fails, keep the node, set `status: failed` and store the message in `error`, so the prompt is not lost. Regenerate retries it.
- On load, treat any node still marked `generating` after several minutes as failed, so interrupted requests do not stay stuck.

**Performance**

The index must handle several thousand nodes in one story folder, built from the metadata cache and updated incrementally when a note changes. The author has an existing export of about 2,400 notes that can serve as a test bed.

## Build stages and acceptance checks

Build in three stages, so the author can start using the plugin after stage 0 and let real use decide what the later stages need.

| Stage | Scope | Done when |
| --- | --- | --- |
| 0. Commands only (desktop first) | Settings tab with both providers and model fetching. New story command creating the folder and root note. New node, regenerate and edit-and-regenerate commands. Navigation commands. Context is the system prompt, lore links and the full path (no summaries yet). Raw errors shown. | A story with several turns can be created, a turn regenerated twice, a prompt edited, and the author can move between versions and regenerations by command |
| 1. Summaries, bookmarks, sidebar | Lazy summaries with hash checking, the "Keep in mind" and pinned details sections, N recent turns, context preview and token estimate. Star and label with the bookmarks list. Sidebar path view with counters. Compile path to note. Mobile testing. | A long story keeps its context small, the preview matches what is sent, starred branches are listed with descendant counts, and the plugin loads and generates on the phone |
| 2. Polish and extras | Header buttons, regenerate with another model, an import adapter for the existing DeepSeek export (its message_id, parent_id, prompt_version and reply_alternative fields map onto this model), a second summary tier, optionally a Canvas view of the tree. | Chosen by use, not fixed in advance |

**Checks that apply throughout**

- Disabling or deleting the plugin leaves every note readable, and every `parent` link resolves in Obsidian.
- Renaming a node's title part breaks nothing.
- Two devices creating nodes offline produce no id collision and no merge conflict.
- The context preview shows exactly what is sent.
- An unknown or mistyped model slug gives a clear error that names it.
- A story folder of several thousand nodes still feels instant when navigating.

## Open questions

These are unverified or undecided, and should be settled while building rather than assumed.

- **Streaming on mobile:** does `fetch` streaming work in the mobile app against OpenRouter, or is the non-streaming `requestUrl` fallback the only option there?
- **Reasoning fields:** what are the exact response field names for reasoning text from OpenRouter and from LM Studio, and does each provider need a request parameter to enable it?
- **Token counting:** is the characters-divided-by-4 estimate good enough, or is a tokenizer library worth adding?
- **Hand-edited outputs:** the current rule is that descendants use the edited text and the stale summary is regenerated. Confirm this is the behaviour the author wants.
- **Last active node:** root note field versus local plugin data (see the sync section).
- **Summary model:** whether the default should be a separate cheap model or the same model used for generation.
- **Import:** whether the DeepSeek export should be converted into this format or only read in place.

