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

Select a passage in a node's text and save it to a separate note, together with a link back to the source node.

Why: the quality of the generated prose in general doesn't matter, but about one passage in a hundred is worth reusing in the author's own writing (an example: a vivid description of nausea in a moving wagon). The idea is kept and the wording is improved by hand later, so the passages need to live somewhere that is easy to browse.

Sketch:

- A command and a button (header and story menu on mobile) that takes the current selection and appends it to the story's fragments note, e.g. `<story>/Fragments.md`.
- Each entry holds the passage as a quote, a link to the source node note, and the date. An optional one-line comment could be asked for when saving.
- Works in the editor and, ideally, in Reading view (selection via the browser selection), including on mobile.

Open design points (decide when this is picked up):

- One note per story (as first imagined) versus one note per fragment in a `Fragments` folder. A single note edited from two devices can conflict under FolderSync; one file per fragment never does, and a note listing them (a Bases view or a query) could still give the single overview.
- Whether to also record which regeneration or prompt version the passage came from. The link to the node already identifies it.
- Whether saved passages should be marked in the source node (this would modify the node note, which the plugin otherwise avoids).
- Tags or categories (description, dialogue, metaphor) for browsing later.

