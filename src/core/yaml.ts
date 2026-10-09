/** Minimal YAML emitter for the node frontmatter. Parsing is done by Obsidian. */

export type YamlValue = string | number | boolean | null | undefined | YamlValue[] | { [k: string]: YamlValue };

const SAFE_PLAIN = /^[A-Za-z][A-Za-z0-9_./-]*$/;
const RESERVED = /^(true|false|null|yes|no|on|off|~)$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

export function yamlScalar(v: string | number | boolean | null): string {
  if (v === null) return "null";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v === "") return '""';
  if (ISO_TIMESTAMP.test(v)) return v;
  if (SAFE_PLAIN.test(v) && !RESERVED.test(v)) return v;
  if (/^\d{6}-\d{4}-[0-9a-z]{2}$/.test(v)) return v;
  return JSON.stringify(v); // valid YAML double-quoted scalar
}

export function emitYaml(obj: { [k: string]: YamlValue }, indent = 0): string {
  const pad = "  ".repeat(indent);
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${pad}${key}: []`);
      } else {
        lines.push(`${pad}${key}:`);
        for (const item of value) lines.push(`${pad}  - ${yamlScalar(item as string)}`);
      }
    } else if (value !== null && typeof value === "object") {
      const entries = Object.entries(value).filter(([, v]) => v !== undefined);
      if (entries.length === 0) continue;
      lines.push(`${pad}${key}:`);
      lines.push(emitYaml(value, indent + 1));
    } else {
      lines.push(`${pad}${key}: ${yamlScalar(value as string | number | boolean | null)}`);
    }
  }
  return lines.join("\n");
}
