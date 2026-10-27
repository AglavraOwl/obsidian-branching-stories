# Future ideas

Ideas for the polish stage (after the main functions work). Not scheduled.

## Per-prompt style toggles in the prompt window

Add quick settings directly to the prompt input window, so common adjustments don't have to be typed into the prompt each time:

- Length / level of detail (for example brief, normal, detailed).
- Point-of-view changes.
- Possibly other style switches in the same spirit.

Today the same effect is possible by writing something like "Add more details" in the prompt. The toggles would be a convenience on top of that.

Open design points (decide when this is picked up):

- Whether each toggle adds an instruction to the prompt sent to the model, or is a separate part of the context.
- Whether the chosen values are stored in the node's frontmatter, so a regeneration or a later reading shows what was used.
- Whether the toggles are remembered per story or reset for each prompt.

## Save a fragment (built as 0.4.0, see STATUS.md; the notes below are the original plan)

Built differently from the plan in two points (2026-10-27): there is also a combined table of all stories' fragments, and tagging has its own model setting with a preferred-tag list.

Select a passage in a node's text and save it, together with a link back to the source node.

Why: the quality of the generated prose in general doesn't matter, but about one passage in a hundred is worth reusing in the author's own writing (an example: a vivid description of nausea in a moving wagon). The idea is kept and the wording is improved by hand later, so the passages need to live somewhere that is easy to browse.

Decided (2026-10-18), planned for 0.4.0:

- **One file per fragment**, in `<story>/Fragments/` (no sync conflicts under FolderSync). Each file holds the passage as a quote, a link to the source node, the date, and tags in the frontmatter.
- **Automatic tags.** A cheap model reads the paragraph around the selection and returns a few tags (for example `description`, `emotion`, `dialogue`, `metaphor`), so nothing has to be typed on a phone. Tags are editable afterwards.
- **A Bases view per story** (created for the story's `Fragments` folder) to browse and filter the fragments by tag.
- Works in the editor and, ideally, in Reading view, including on mobile; the header and the Story menu get the action.

Still open:

- Whether to mark saved passages in the source node (this would modify the node note, which the plugin otherwise avoids). Leaning no.
- Whether to record the regeneration or prompt version. The link to the node already identifies it.

## Secondary models

Today there is one extra model setting, for summaries. Tagging fragments (above) is a second background task. Plan: separate settings per task, each falling back to the generation model when empty. A specialised summarizer (for example `scaledown/summarize` on OpenRouter, listed on 2026-10-18 at about $0.04 per million input tokens and no output charge) fits summaries but cannot classify or tag, so tagging needs a general cheap model.

## Per-note choice of properties in lore notes

A property in a lore note itself that says whether its properties (frontmatter) are sent to the model, overriding the global setting. Today a link to a heading (`[[Note#Summary]]`) already sends only that section.

## Bookmark sorting (filed 2026-10-23)

The sidebar's bookmark list has one button that switches between "Newest first" and "Largest first" ("largest" = most nodes below the starred node, the same number as the "N below" badge). Wanted instead: a small sort menu plus a direction arrow with these criteria:

- Date created, newest or oldest first (this is the starred node's own creation date; starring does not store a date, so "recently starred" would need a `starred_at` property written when starring).
- Branch size (most nodes below first).
- Path length: how many nodes lead from the start of the story to the starred node, longest or shortest first.

## Search within a story (filed 2026-10-23)

Problem: stories live inside a big vault with many notes that mention the same names, so a vault-wide search finds too much and the folder has to be restricted by hand.

Possible, in two sizes:

- **Small:** a command "Search in this story" that opens Obsidian's own search with `path:"Stories/<story>"` already filled in. This relies on an internal, undocumented part of Obsidian's search pane, so it may break with an Obsidian update.
- **Fuller (preferred):** the plugin's own search window over the story's notes only (nodes, story note, optionally the lore notes it links). Results show the node's label, the version and regeneration counters, the matching section (prompt or output) and a snippet; a tap opens the node. It can search only prompts or only outputs, and it works on mobile because it needs no hotkeys.

## Style sample (filed 2026-10-23)

Problem: the model drifts. Each new node exaggerates the traits of the previous ones until the prose becomes repetitive or wordy (the recent turns are sent as earlier model replies, so the model imitates and amplifies them).

Idea: assign a note with a style sample to the story (a `style:` link in the story note, or a section there) and send it with every generation as its own block: match the voice, rhythm, sentence length and level of detail; do not copy the content. Where to put it matters (the end of the context is followed most closely), so make the position configurable and compare. The context preview already shows each part's size.

Other levers worth testing together: fewer recent turns sent verbatim (1 instead of 2; more summaries), an explicit list of habits to avoid, a length target (see "Length control").

Can be tried today without the plugin: paste a short sample into the story note's `## System prompt` section.

**Decided 2026-10-23:** a `## Style sample` section in the story root note; plain text and/or `[[links]]` (a link to a note sends its body without frontmatter; `[[Note#Heading]]` sends one section). Sent as its own `<style_sample>` block (first version: end of the system message; changed the same day to the final user message, before the new prompt, because the recent turns are earlier model replies and outweighed a sample placed before them), with a fixed one-line instruction inside the block (match voice, rhythm, sentence length and level of detail; do not copy content or events), so the system prompt text is untouched. Optional `style_position` property (`end` default = final user message, `before-log` = end of system message, `start` = after the system prompt) to compare placements. Shown as its own line in the context preview. A sample of one or two paragraphs is enough. **Later, with the prompt-window settings:** a "Use style sample" toggle (on by default) so a single prompt can give its own style instruction instead; turning it off drops the whole block, instruction included.

## Regenerations as one branch (per-story option, filed 2026-10-23)

Today a regeneration is a sibling node, so continuing from different regenerations of the same prompt creates separate branches (this mirrors web chats). Wanted: an option, chosen when creating a story, where only a new prompt version creates a branch, regenerations are cycled like alternatives of one turn, and one of them can be marked as the main one, used for the story's path, for compiling, and for what the next turn continues from.

Feasible, but the biggest of the filed ideas: it touches the index, navigation, the sidebar, context building, compiling and summaries. Notes for the design:

- Keep the node files as they are (one note per variant, `regen_of` already links them) and add `main: true` on the chosen variant, so there is no migration and no new file format. The per-story mode would be a property of the story note (for example `regenerations: variants`), default as now.
- Children attach to the turn (the original node) and the path uses the main variant's output. Summaries keep working because each note's summary is checked against its own output.
- Open question: if the main variant is switched after later turns were written from another variant, the continuation no longer matches. Record which variant a child was written after and show a hint.
- Switching mode later for an existing story is probably out of scope.

## Length control (filed 2026-10-23)

See the answer given on 2026-10-23: models have no exact sense of length; the reliable tools are an explicit length in the prompt, the structure of the answer, and `max_tokens` only as a safety limit. Plugin features that would help:

- A "Length" choice in the prompt window (links to the style toggles above) that adds a word-count instruction and sets `max_tokens` to a safe multiple of it.
- When a reply is cut off by the limit (`finish_reason: length`, already detected): a "Continue" action that asks the model to carry on from where the text stopped.
- A per-story default length in the story note.

## Quick model switch in the prompt window (filed 2026-10-23; built in 0.3.6, see STATUS.md)

Built for the New prompt and Edit prompt windows only. Plain Regenerate keeps the node's recorded model and has no picker (author's decision, 2026-10-27).

Star models in the big model list (the star toggle lives in the picker, not only in settings), and show a model chip in the prompt window that offers the starred models first plus "More models…". The choice applies to that generation only and is recorded in the node. This is the same feature as "Regenerate with another model" (planned for 0.3.4); do them together, for new nodes, regenerations and prompt edits.
