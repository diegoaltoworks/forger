/**
 * `check ui` against approved baselines: every capture the owner approved is
 * compared with its approved image. A capture that moved beyond the tolerance
 * is a finding, and a side-by-side diff image is written next to it. Re-approving
 * is the owner's action (`ui approve`), never this check's.
 */

import {existsSync, readFileSync, writeFileSync} from 'fs';
import {join} from 'path';

import {BASELINE_MANIFEST, baselinePath, compareImages, decodePng, diffImage, encodePng, parseBaselines, type UiConfig} from '../../ui';
import type {Finding} from '../waivers';

export const BASELINE_OPINION = 'ui.baselines';

/** The diff image's path for a capture file. */
export function diffPath(captureFile: string): string {
  return captureFile.replace(/\.png$/i, '') + '.diff.png';
}

export function runBaselineCheck(projectRoot: string, config: UiConfig): Finding[] {
  const manifestPath = join(projectRoot, BASELINE_MANIFEST);
  if (!existsSync(manifestPath)) return [];
  const manifest = parseBaselines(readFileSync(manifestPath, 'utf-8'));
  const findings: Finding[] = [];
  const finding = (file: string, rule: string, detail: string): number => findings.push({file, line: 1, rule, opinion: BASELINE_OPINION, detail});
  for (const entry of manifest.approved) {
    for (const file of entry.files) {
      const baseline = join(projectRoot, baselinePath(file));
      const capture = join(projectRoot, file);
      if (!existsSync(baseline)) finding(file, 'baseline_missing', `"${entry.name}" is approved but ${baselinePath(file)} is missing; the owner re-approves with ui approve`);
      else if (!existsSync(capture)) finding(file, 'capture_missing', `"${entry.name}" is approved but this capture is missing; run screenshot`);
      else {
        const was = decodePng(readFileSync(baseline));
        const now = decodePng(readFileSync(capture));
        const result = compareImages(was, now, config.tolerance);
        if (!result.same) {
          writeFileSync(join(projectRoot, diffPath(file)), encodePng(diffImage(was, now, config.tolerance)));
          const how = result.sizeChanged ? `size changed from ${was.width}x${was.height} to ${now.width}x${now.height}` : `${result.differing} of ${result.total} pixels differ beyond the tolerance`;
          finding(file, 'baseline_changed', `"${entry.name}" differs from its approved baseline: ${how}; see ${diffPath(file)}; only the owner re-approves, with ui approve ${entry.name}`);
        }
      }
    }
  }
  return findings;
}
