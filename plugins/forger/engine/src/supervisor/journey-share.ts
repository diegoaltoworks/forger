/**
 * How much of the merged work changed what people do in the app and how much
 * was upkeep. Pure; the CLI reads the journeys file and the merged PRs.
 */

import {globToRegExp} from '../checks';

export interface JourneyPaths {
  name: string;
  paths: string[];
}

export interface ChangedFiles {
  number: number;
  files: string[];
}

export interface JourneyShare {
  merged: number;
  touched_a_journey: number;
  by_journey: Record<string, number>;
  upkeep: number;
}

/** A PR counts once in `touched_a_journey` however many journeys it touches, and once for each of them. */
export function computeJourneyShare(prs: ChangedFiles[], journeys: JourneyPaths[]): JourneyShare {
  const matchers = journeys.map(j => ({name: j.name, res: j.paths.map(globToRegExp)}));
  const byJourney: Record<string, number> = Object.fromEntries(journeys.map(j => [j.name, 0]));
  let touched = 0;
  for (const pr of prs) {
    const hit = matchers.filter(m => pr.files.some(f => m.res.some(re => re.test(f))));
    if (hit.length > 0) touched += 1;
    for (const m of hit) byJourney[m.name] += 1;
  }
  return {merged: prs.length, touched_a_journey: touched, by_journey: byJourney, upkeep: prs.length - touched};
}

export function formatJourneyShare(s: JourneyShare): string {
  const per = Object.entries(s.by_journey).map(([k, v]) => `${k} ${v}`).join(', ');
  return `journeys: ${s.touched_a_journey} of ${s.merged} merged PR(s) changed a journey, ${s.upkeep} upkeep${per ? `: ${per}` : ''}`;
}
