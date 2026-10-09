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
