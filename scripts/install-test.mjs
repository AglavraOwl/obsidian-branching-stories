// Build the plugin and copy it into the local test vault.
import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";

const target = "test-vault/.obsidian/plugins/branching-stories";
execSync("node esbuild.config.mjs production", { stdio: "inherit" });
mkdirSync(target, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) copyFileSync(f, `${target}/${f}`);
console.log(`Installed into ${target}`);
