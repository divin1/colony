import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadSkill } from "./skill";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "colony-skill-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, content: string): string {
  const p = join(dir, name);
  writeFileSync(p, content);
  return p;
}

describe("loadSkill", () => {
  it("strips YAML frontmatter and returns the body", () => {
    const path = write("skill.md", `---
name: my-skill
description: Does stuff
---
These are the skill instructions.
They span multiple lines.`);
    expect(loadSkill(path)).toBe("These are the skill instructions.\nThey span multiple lines.");
  });

  it("trims leading and trailing whitespace from the body", () => {
    const path = write("skill.md", `---
name: trimmed
---

  Body with surrounding whitespace.
`);
    expect(loadSkill(path)).toBe("Body with surrounding whitespace.");
  });

  it("returns the full content when there is no frontmatter", () => {
    const path = write("skill.md", "Just plain instructions.\nNo frontmatter here.");
    expect(loadSkill(path)).toBe("Just plain instructions.\nNo frontmatter here.");
  });

  it("handles CRLF line endings in frontmatter", () => {
    const path = write("skill.md", "---\r\nname: crlf\r\n---\r\nInstruction body.");
    expect(loadSkill(path)).toBe("Instruction body.");
  });

  it("handles additional frontmatter fields without error", () => {
    const path = write("skill.md", `---
name: rich-skill
description: A detailed skill
disable-model-invocation: true
allowed-tools: Read Grep
---
Skill body here.`);
    expect(loadSkill(path)).toBe("Skill body here.");
  });

  it("returns empty string for a file with frontmatter and empty body", () => {
    const path = write("skill.md", "---\nname: empty\n---\n");
    expect(loadSkill(path)).toBe("");
  });

  it("returns empty string for a completely empty file", () => {
    const path = write("skill.md", "");
    expect(loadSkill(path)).toBe("");
  });

  it("throws with a clear message when the file does not exist", () => {
    expect(() => loadSkill(join(dir, "nonexistent.md"))).toThrow("Skill file not found");
  });

  it("does not treat a single --- line as frontmatter", () => {
    const path = write("skill.md", "---\nJust a horizontal rule, no closing ---.");
    expect(loadSkill(path)).toBe("---\nJust a horizontal rule, no closing ---.");
  });

  it("preserves internal markdown formatting in the body", () => {
    const path = write("skill.md", `---
name: formatted
---
## Heading

- Bullet one
- Bullet two

\`\`\`bash
echo hello
\`\`\``);
    const body = loadSkill(path);
    expect(body).toContain("## Heading");
    expect(body).toContain("- Bullet one");
    expect(body).toContain("echo hello");
  });
});
