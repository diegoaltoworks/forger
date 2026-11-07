/**
 * The image contract of the `docker` sandbox: what an image must provide for a
 * worker to run in it. The items and their fixes are data; `check sandbox` runs
 * each probe in the image and prints one line per item.
 */

import type {CapturingRunner} from '../ports';

export interface ContractItem {
  name: string;
  /** A shell command that exits 0 when the image provides the item. */
  probe: string;
  /** What to add to the image when the probe fails. */
  fix: string;
}

export interface ContractResult {
  name: string;
  ok: boolean;
  fix: string;
}

/** `harness` is the CLI the configured harness runs, which must be on the PATH. */
export function contractItems(harness: string): ContractItem[] {
  return [
    {name: 'git', probe: 'command -v git', fix: 'install git in the image'},
    {name: 'bun', probe: 'command -v bun', fix: 'install bun in the image'},
    {name: `harness CLI (${harness})`, probe: `command -v ${harness}`, fix: `install the ${harness} CLI in the image and put it on the PATH`},
    {name: 'non-root user', probe: 'test "$(id -u)" != 0', fix: 'add a USER instruction for an ordinary user; a harness refuses to run unattended as root'},
  ];
}

/** Runs each probe in a throwaway container of the image. */
export function checkContract(run: CapturingRunner, image: string, items: ContractItem[]): ContractResult[] {
  return items.map(item => {
    const quoted = `'${item.probe.replace(/'/g, `'\\''`)}'`;
    const done = run(`docker run --rm --entrypoint sh '${image.replace(/'/g, `'\\''`)}' -c ${quoted}`);
    return {name: item.name, ok: done.exitCode === 0, fix: item.fix};
  });
}

export function formatContract(image: string, results: ContractResult[]): string[] {
  return [`image ${image}`, ...results.map(r => (r.ok ? `pass ${r.name}` : `missing ${r.name}: ${r.fix}`))];
}
