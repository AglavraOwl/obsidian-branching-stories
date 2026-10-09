// Writes a small hand-made story tree into the test vault, so navigation, bookmarks, the sidebar and
// summaries can be tried without generating anything first.
//   node scripts/seed-test-story.mjs
//
// Shape (number = depth):
//   1 ─ 2a                              (prompt version 1 of 2)
//     └ 2b ─ 3 ─ 4 ─ 5 ─ 6              (prompt version 2; 2b has 1 regeneration, 3 has 2)
//                └ 4b (starred "Koss recovers") ─ 5b
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const STORY = "test-vault/Stories/Seeded Tree";
if (existsSync(`${STORY}/_story.md`)) {
  console.log("Seeded Tree already exists; delete the folder first to reseed.");
  process.exit(0);
}
mkdirSync(`${STORY}/nodes`, { recursive: true });

writeFileSync(
  `${STORY}/_story.md`,
  `---
branching_story: true
lore:
  - "[[Koss]]"
---
# Seeded Tree

## System prompt
You are a skilled fiction writer. Expand the user's brief into vivid prose. Write only the story text.

## Lore
A remote northern village in deep winter. Moran cares for Koss: [[Moran]].

## Pinned details
- It is always cold.
`,
);

const nodes = [
  // key, parent, regenOf, title, prompt, output, extra
  ["1", null, null, "Koss wakes at dawn", "Koss wakes at dawn in the cottage, weak and disoriented.", "Koss woke to grey light and the smell of smoke. For a long moment he did not know the ceiling above him."],
  ["2a", "1", null, "Moran brings broth", "Moran brings him broth and says little.", "Moran set the bowl down without a word and waited until Koss's hands stopped shaking."],
  ["2b", "1", null, "Atka visits the cottage", "Atka visits and examines his hand.", "Atka arrived with snow on her shoulders, and unwrapped Koss's left hand as if it were glass."],
  ["2b-r1", "1", "2b", "Atka visits the cottage", "Atka visits and examines his hand.", "The healer came at noon. She asked nothing and looked at everything."],
  ["3", "2b", null, "Atka leaves a remedy", "Atka leaves a remedy with Moran.", "Before leaving, Atka pressed a small clay jar into Moran's palm and told her how much, and how seldom."],
  ["3-r1", "2b", "3", "Atka leaves a remedy", "Atka leaves a remedy with Moran.", "At the door Atka lingered. The jar she gave Moran was warm from her pocket."],
  ["3-r2", "2b", "3", "Atka leaves a remedy", "Atka leaves a remedy with Moran.", "Atka explained the dosage twice, then a third time, slower."],
  ["4", "3", null, "The first night with it", "That night the pain is bad, and Moran offers the remedy.", "By evening the pain had gathered in Koss's hand like a stone. Moran held out the jar and waited for him to ask."],
  ["5", "4", null, "He wakes confused", "Koss wakes, dazed, and asks if he lost weeks again.", "He came up slowly through warm water. 'How long?' he asked. 'An evening,' Moran said."],
  ["6", "5", null, "Winter deepens", "A week passes; Koss starts to walk the room.", "A week of snow. Koss walked the length of the cottage and back, and did not fall."],
  ["4b", "3", null, "Koss tries without it", "Koss refuses the remedy and tries to sit it out.", "He shook his head at the jar. Moran put it back on the shelf without comment, which was worse.", { starred: true, label: "Koss recovers" }],
  ["5b", "4b", null, "A bad night, a better morning", "The night is terrible; morning is quiet.", "The night took everything he had. At dawn the fire was still lit, and so was he."],
];

// Ids are YYMMDD-HHMM-xx; nodes are spaced three minutes apart so they sort in creation order.
const ids = {};
nodes.forEach(([key], i) => {
  const hh = 9 + Math.floor(((i + 1) * 3) / 60);
  const mm = ((i + 1) * 3) % 60;
  ids[key] = `261009-${String(hh).padStart(2, "0")}${String(mm).padStart(2, "0")}-${(i + 1).toString(36).padStart(2, "0")}`;
});

const file = {};
for (const [key, , , title] of nodes) file[key] = `${ids[key]} ${title}`;

nodes.forEach(([key, parent, regenOf, title, prompt, output, extra], i) => {
  const hh = 9 + Math.floor(((i + 1) * 3) / 60);
  const mm = ((i + 1) * 3) % 60;
  const created = `2026-10-09T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
  const lines = [
    "---",
    `id: ${ids[key]}`,
    `parent: ${parent ? `"[[${file[parent]}]]"` : '""'}`,
    ...(regenOf ? [`regen_of: "[[${file[regenOf]}]]"`] : []),
    `created: ${created}`,
    "status: done",
    "provider: lmstudio",
    "model: fake-writer",
    ...(extra?.starred ? ["starred: true"] : []),
    ...(extra?.label ? [`label: "${extra.label}"`] : []),
    "---",
    "",
    "## Prompt",
    prompt,
    "",
    "## Output",
    output,
    "",
    "## Summary",
    "",
    "## Keep in mind",
    "",
  ];
  writeFileSync(`${STORY}/nodes/${file[key]}.md`, lines.join("\n"));
});
console.log(`Seeded ${nodes.length} nodes into ${STORY}`);
