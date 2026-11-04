/**
 * The shape every side effect that runs a command takes. The core is written
 * against these types and receives a concrete runner from the composition root,
 * so its branching logic is unit-testable with canned output.
 */

export type CommandRunner = (cmd: string) => string;

/** A command's whole result, for callers that must tell a failure from empty output. */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CapturingRunner = (cmd: string) => CommandResult;

/** A plain runner seen as a capturing one: output is stdout, and a throw is a failure with its message as stderr. */
export function capturing(run: CommandRunner): CapturingRunner {
  return cmd => {
    try {
      return {stdout: run(cmd), stderr: '', exitCode: 0};
    } catch (e) {
      return {stdout: '', stderr: (e as Error).message, exitCode: 1};
    }
  };
}
