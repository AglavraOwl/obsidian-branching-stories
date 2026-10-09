# Branching Stories

An Obsidian plugin for iterative story generation. You write a short brief, a model expands it into prose, and every attempt is kept as a note in a tree: editing a prompt, regenerating and branching never lose anything. Everything is plain markdown plus frontmatter, so uninstalling the plugin loses nothing.

Providers: **LM Studio** and **OpenRouter** (both OpenAI-compatible). Personal-use tool.

Status: **stage 0** (commands only). See `branching-story-plugin-spec (1).md` for the full design.

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
| Go to the story's last active node | Per-device (not synced) |
| Preview context (new node / this node) | Shows exactly what would be sent, with token estimates |

### Linking lore into prompts

- `_story.md` sections **System prompt**, **Lore** and **Pinned details** are sent with every turn, in full, never summarized. Notes linked in **Lore** or in the `lore:` property are included in full.
- A `[[Note]]` or `[[Note#Heading]]` in a prompt includes that note (or just that section) for that turn and for the following N turns that are still sent in full. In stage 0 every turn is sent in full, so the link stays in effect down the branch.
- To keep a note in effect on a branch for good, link it in that node's **Keep in mind** section.
- Links are cleaned from the text the model sees (`[[Atka]]` becomes `Atka`). Frontmatter of linked notes is dropped. Links inside linked notes are not followed.

## Trying it without a real model

```
node scripts/fake-llm.mjs
```

Then set provider LM Studio, model `fake-writer`. The fake reply echoes what it received.

## Development

```
npm install
npm test            # unit tests
npm run install-test   # build and copy into test-vault/.obsidian/plugins/
```

Open `test-vault/` as a vault in Obsidian and enable the plugin.
