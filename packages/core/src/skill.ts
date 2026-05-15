import { readFileSync } from "fs";

/**
 * Loads a SKILL.md file and returns its instruction body.
 * Strips YAML frontmatter (--- ... ---) if present.
 * Follows the Anthropic Agent Skills open standard.
 *
 * Throws with a clear message if the file does not exist.
 */
export function loadSkill(filePath: string): string {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Skill file not found: ${filePath}`);
  }

  // Match YAML frontmatter: starts with ---, ends with ---, rest is the body.
  // Handles both LF and CRLF line endings.
  const match = raw.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n([\s\S]*)$/);
  if (match) {
    return match[1].trim();
  }

  // No frontmatter — return the whole file.
  return raw.trim();
}
