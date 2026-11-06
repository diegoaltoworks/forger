/** The roadmap rule: each item under a numbered section links its issue. Pure. */

export const ROADMAP_PATH = 'docs/07-roadmap.md';
export const ROADMAP_OPINION = 'docs.roadmap-issues';

export interface RoadmapProblem {
  line: number;
  rule: 'roadmap-item-no-issue';
  detail: string;
}

const NUMBERED = /^##\s+\d+\./;
const ISSUE_LINK = /\]\([^)\s]*\/issues\/\d+[^)]*\)/;

export function checkRoadmap(text: string): RoadmapProblem[] {
  const out: RoadmapProblem[] = [];
  let inSection = false;
  let item: {line: number; text: string} | null = null;
  const flush = (): void => {
    if (item && !ISSUE_LINK.test(item.text)) out.push({line: item.line, rule: 'roadmap-item-no-issue', detail: 'a roadmap item must link the issue that tracks it'});
    item = null;
  };
  text.split('\n').forEach((raw, i) => {
    if (/^#{1,6}\s/.test(raw)) {
      flush();
      inSection = NUMBERED.test(raw);
    } else if (inSection && /^[-*]\s/.test(raw)) {
      flush();
      item = {line: i + 1, text: raw};
    } else if (item && /^\s+\S/.test(raw)) {
      item.text += ` ${raw}`;
    } else flush();
  });
  flush();
  return out;
}
