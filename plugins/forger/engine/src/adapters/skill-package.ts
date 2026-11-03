/**
 * Repackages a forger command as a skill for harnesses that load repository
 * skills (a folder holding `SKILL.md` with `name` and `description`) in place of
 * command files. The command's body is kept as it is.
 */

/** The skill name an installed command gets: namespaced so it cannot collide with a project's own. */
export function skillName(command: string): string {
  return `forger-${command}`;
}

/** The skill the worker command was installed as: `forger:auto-ticket` is the skill `forger-auto-ticket`. */
export function workerSkillName(workerCommand: string): string {
  return workerCommand.replace(/:/g, '-');
}

/** Frontmatter reduced to `name` and the command's `description`; the body and plugin root are resolved. */
export function packageAsSkill(source: string, pluginRoot: string, name: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  const description = match?.[1].split('\n').find(l => l.startsWith('description:')) ?? `description: ${name}`;
  const body = match ? source.slice(match[0].length) : source;
  const text = `---\nname: ${name}\n${description}\n---\n${body}`;
  return text.replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT/g, pluginRoot);
}
