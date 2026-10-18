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

## Save a fragment

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
