/**
 * Before and after: the base branch is captured in a worktree of its own, the
 * branch is captured as usual, and each screen whose two images differ gets one
 * side-by-side image, before on the left. The pairing is pure; the run is
 * written against the ports and an `ImageFiles` seam, so it is tested with fakes.
 */

import {basename} from 'path';

import type {AppServer, Screenshotter} from '../ports';
import {compareImages, sideBySide} from './compare';
import {runScreenshots, type ScreenshotReport} from './capture';
import {planCaptures, type Capture} from './plan';
import {decodePng, encodePng} from './png';
import type {UiConfig} from './ui-config';

export const COMPARE_DIR = 'docs/screenshots/compare/';
/** Where the base branch's images wait until they are paired; removed after the run. */
export const BEFORE_SCRATCH = '.forger/ui-before/';

export interface ScreenPair {
  before: string;
  after: string;
  out: string;
}

export interface BeforePlan {
  /** The same screens as the branch's plan, written under the scratch folder. */
  base: Capture[];
  pairs: ScreenPair[];
}

export function planBefore(config: UiConfig, scratch: string = BEFORE_SCRATCH): BeforePlan {
  const after = planCaptures(config);
  const before = planCaptures(config, scratch);
  return {
    base: before,
    pairs: after.map((c, i) => ({before: before[i].file, after: c.file, out: `${COMPARE_DIR}${basename(c.file)}`})),
  };
}

/** Reads and writes repo-relative image files. */
export interface ImageFiles {
  read(path: string): Uint8Array | undefined;
  write(path: string, bytes: Uint8Array): void;
}

export interface BeforeReport extends ScreenshotReport {
  /** The side-by-side images written: one per screen that changed. */
  compare: string[];
  /** Screens whose before and after images match within the tolerance; they get no image. */
  unchanged: string[];
}

export async function runBefore(
  config: UiConfig,
  projectRoot: string,
  baseServer: AppServer,
  server: AppServer,
  shooter: Screenshotter,
  files: ImageFiles
): Promise<BeforeReport> {
  const plan = planBefore(config);
  await runScreenshots(config, projectRoot, baseServer, shooter, BEFORE_SCRATCH);
  const report = await runScreenshots(config, projectRoot, server, shooter);
  const compare: string[] = [];
  const unchanged: string[] = [];
  for (const pair of plan.pairs) {
    const was = files.read(pair.before);
    const now = files.read(pair.after);
    if (now === undefined) continue;
    // A screen the base does not have (a new route) has no before to set beside it.
    if (was === undefined) continue;
    const a = decodePng(was);
    const b = decodePng(now);
    if (compareImages(a, b, config.tolerance).same) {
      unchanged.push(pair.after);
      continue;
    }
    files.write(pair.out, encodePng(sideBySide(a, b)));
    compare.push(pair.out);
  }
  return {...report, compare, unchanged};
}
