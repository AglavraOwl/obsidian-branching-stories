# Branching Stories

An Obsidian plugin for iterative story generation. You write a short brief, a model expands it into prose, and every attempt is kept as a note in a tree: editing a prompt, regenerating and branching never lose anything. Everything is plain markdown plus frontmatter, so uninstalling the plugin loses nothing.

Providers: **LM Studio** and **OpenRouter** (both OpenAI-compatible). Personal-use tool.

Status: **stage 1** (summaries, navigation bar, bookmarks, sidebar; PC only. Mobile comes in stage 2). See `branching-story-plugin-spec (1).md` for the full design.

## Install with BRAT

1. Install the **BRAT** plugin in Obsidian.
2. BRAT → *Add Beta plugin* → paste the repo URL (`AglavraOwl/obsidian-branching-stories`).
3. Enable *Branching Stories* in Community plugins.

To update: bump `version` in `manifest.json` and `package.json`, add the version to `versions.json`, commit, then `git tag <version> && git push --tags`. The GitHub Action builds and publishes the release; BRAT picks it up.

## Using it

Settings → Branching Stories: choose provider, fetch models, pick one, add an OpenRouter key.

Commands (command palette; assign hotkeys as you like):

| Command | What it does |
| --- | --- |
| New story | Creates `Stories/<name>/_story.md` (system prompt, lore, pinned details) |
| New node from here | Prompt dialog → new child of the open node (or the first node, from `_story.md`) |
| Regenerate | New sibling with the same prompt (`regen_of` set) |
| Edit prompt and regenerate | New sibling with an edited prompt (a new prompt version) |
| Stop generation | Cancels and keeps the text received so far |
| Go to parent / child | Child picker if there are several |
| Previous / next prompt version, regeneration | Moves along siblings |
| Choose prompt version… / Choose regeneration… | Pick from a list |
| Go to the story's last active node | Per-device (not synced) |
| Toggle star on this node / Set branch label… | Bookmarks: `starred` and `label` in the frontmatter |
| Regenerate summary of this node | Forces a new summary (replaces even a hand-written one) |
| Compile path to note | Joins the Output sections from the root to this node into `<story>/Compiled/` |
| Open story sidebar | Path with counters, what the node continues with, and the bookmarks list |
| Preview context (new node / this node) | Shows exactly what would be sent, with token estimates |

### Navigation bar and buttons

Every node note shows a bar under its properties: parent, `Version 2 of 3` with arrows, `Regeneration 1 of 2` with arrows, children, and a star. Arrows grey out when there is no neighbour; clicking the counter lists them. The note header also has buttons for new node, regenerate, edit prompt and regenerate, star, and stop while generating. The bar is drawn by the plugin; nothing is written into the note for it.

### Summaries

Only the last N turns (setting, default 2; `recent_turns` in `_story.md` overrides it; 0 = send everything) are sent in full. Older turns are sent as their `## Summary`.

- Summaries are made when needed: before generating a child, every turn outside the window that has no summary, or whose Output changed, is summarized (about 60 to 120 words) and written into that note. Discarded regenerations never cost a summary call.
- Three or more at once show a progress window with Cancel.
- Edit a summary by hand and it is never overwritten (`summary_locked`).
- Summaries use the generation model unless you pick another one in settings.
- The context preview marks summaries that are still pending.

Extra frontmatter fields for this: `summary_hash` (hash of the Output), `summary_check` (hash of the summary the plugin wrote, used to notice hand edits), `summary_locked`.

### Linking lore into prompts

- `_story.md` sections **System prompt**, **Lore** and **Pinned details** are sent with every turn, in full, never summarized. Notes linked in **Lore** or in the `lore:` property are included in full.
- A `[[Note]]` or `[[Note#Heading]]` in a prompt includes that note (or just that section) for that turn and for the following N turns that are still sent in full. With recent turns set to 0 every turn is sent in full, so the link stays in effect down the branch.
- To keep a note in effect on a branch for good, link it in that node's **Keep in mind** section.
- Links are cleaned from the text the model sees (`[[Atka]]` becomes `Atka`). Frontmatter of linked notes is dropped. Links inside linked notes are not followed.

## Trying it without a real model

```
node scripts/fake-llm.mjs
```

Then set provider LM Studio, model `fake-writer`. The fake reply echoes what it received.

`node scripts/seed-test-story.mjs` writes a ready-made tree (`Seeded Tree`: two prompt versions, regenerations, a starred branch, 6 levels deep) into the test vault, to try navigation, the sidebar and summaries.

## Development

```
npm install
npm test            # unit tests
npm run install-test   # build and copy into test-vault/.obsidian/plugins/
```

Open `test-vault/` as a vault in Obsidian and enable the plugin.
