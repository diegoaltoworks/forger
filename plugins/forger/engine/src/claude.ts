/**
 * Spawns the headless `claude` process for one iteration and collects its
 * output, enforcing the per-iteration timeout. This is the genuine side-effect
 * boundary - it is exercised by integration rather than unit tests.
 */

import {spawn} from 'child_process';
import {writeFileSync} from 'fs';

import type {Tier} from './config';

export interface ClaudeResult {
  exitCode: number;
  output: string;
  timedOut: boolean;
}

export interface RunClaudeOptions {
  prompt: string;
  sessionId: string;
  outputFile: string;
  tier: Tier;
  cwd: string;
  timeoutMinutes: number;
}

export function runClaude(opts: RunClaudeOptions): Promise<ClaudeResult> {
  const {prompt, sessionId, outputFile, tier, cwd, timeoutMinutes} = opts;
  return new Promise(resolve => {
    const args = [
      '--print',
      '--model',
      tier.model,
      '--max-budget-usd',
      tier.budget.toString(),
      '--session-id',
      sessionId,
      '--dangerously-skip-permissions',
    ];

    const child = spawn('claude', args, {cwd, stdio: ['pipe', 'pipe', 'pipe']});

    let output = '';
    let timedOut = false;

    const timeout = setTimeout(
      () => {
        timedOut = true;
        child.kill('SIGTERM');
      },
      timeoutMinutes * 60 * 1000
    );

    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });
    child.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.on('close', code => {
      clearTimeout(timeout);
      writeFileSync(outputFile, output);
      resolve({exitCode: code ?? 1, output, timedOut});
    });

    child.on('error', err => {
      clearTimeout(timeout);
      writeFileSync(outputFile, `Error: ${err.message}\n${output}`);
      resolve({exitCode: 1, output: `Error: ${err.message}`, timedOut: false});
    });

    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}
