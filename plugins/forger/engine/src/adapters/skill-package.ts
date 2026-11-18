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

/**
 * The source commands' plugin root variable, replaced by the harness's own, which fails with a message when
 * unset. The result is the same on every machine, so a committed file never differs by who wrote it.
 */
export function resolvePluginRoot(text: string, rootVar: string): string {
  return text.replace(/\$\{CLAUDE_PLUGIN_ROOT\}|\$CLAUDE_PLUGIN_ROOT/g, () => `\${${rootVar}:?set ${rootVar} to the forger plugin folder}`);
}

/** Frontmatter reduced to `name` and the command's `description`; the body's plugin root is the harness's variable. */
export function packageAsSkill(source: string, name: string, rootVar: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  const description = match?.[1].split('\n').find(l => l.startsWith('description:')) ?? `description: ${name}`;
  const body = match ? source.slice(match[0].length) : source;
  const text = `---\nname: ${name}\n${description}\n---\n${body}`;
  return resolvePluginRoot(text, rootVar);
}
