/**
 * CI as the loop's witness: the workflow runs the configured gates, its job
 * summary shows which opinions those gates enforce, and shipped instructions
 * never merge before CI has spoken. Everything here is pure; the CLI and the
 * tests read the files.
 */

import type {CheckReport, CheckStatus} from './checks';

export const WORKFLOW_PATH = '.github/workflows/ci.yml';

const STATUS_CELL: Record<CheckStatus, string> = {passed: 'passed', failed: '**failed**', waived: 'waived'};

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/** The job summary: one row per check with its opinion ids and status, then the waivers in force. */
export function formatSummary(report: CheckReport): string {
  const lines = [`## forger check: ${report.ok ? 'passed' : 'failed'}`, ''];
  if (report.results.length === 0) {
    lines.push('No checks declared by the installed packs.');
  } else {
    lines.push('| Check | Opinions | Status | Open | Waived |', '|---|---|---|---|---|');
    for (const r of report.results) {
      const opinions = r.opinions.length === 0 ? '-' : r.opinions.map(o => `\`${o}\``).join(', ');
      lines.push(`| ${r.check} | ${opinions} | ${STATUS_CELL[r.status]} | ${r.violations.length} | ${r.waived.length} |`);
    }
  }
  const failures = report.results.flatMap(r => r.violations.map(v => `- \`${v.file}:${v.line}\` ${v.opinion}: ${cell(v.detail)}`));
  if (failures.length > 0) lines.push('', '### Open findings', '', ...failures);
  lines.push('', '### Waivers in force', '');
  if (report.waivers.length === 0) lines.push('None.');
  else {
    const stale = new Set(report.staleWaivers.map(w => `${w.opinion}\0${w.path}`));
    lines.push('| Opinion | Path | Reason | Approved by |', '|---|---|---|---|');
    for (const w of report.waivers) {
      const mark = stale.has(`${w.opinion}\0${w.path}`) ? ' (stale)' : '';
      lines.push(`| \`${w.opinion}\`${mark} | \`${cell(w.path)}\` | ${cell(w.reason)} | ${cell(w.approved_by)} |`);
    }
  }
  return lines.join('\n');
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"')))) {
    return v.startsWith("'") ? v.slice(1, -1).replace(/''/g, "'") : v.slice(1, -1).replace(/\\"/g, '"');
  }
  return v;
}

/** The single-line `run:` commands of a workflow, in order. Block scalars are skipped: a gate step is one line. */
export function workflowRuns(yaml: string): string[] {
  const out: string[] = [];
  for (const line of yaml.split('\n')) {
    const m = line.match(/^\s*(?:-\s+)?run:\s*(.*)$/);
    if (!m) continue;
    const value = m[1].replace(/\s+#.*$/, '');
    if (value === '' || value.startsWith('|') || value.startsWith('>')) continue;
    out.push(unquote(value));
  }
  return out;
}

/** Null when a workflow step runs exactly the configured gates; otherwise why it drifted. */
export function gatesDrift(yaml: string, gates: string | null): string | null {
  if (gates === null || gates.trim() === '') return 'no gates configured in .claude/workloop.config.json';
  if (workflowRuns(yaml).includes(gates.trim())) return null;
  return `no step in ${WORKFLOW_PATH} runs the configured gates verbatim: ${gates}`;
}

const MERGE = /\bgh\s+pr\s+merge\b/;
const WAIT = /\bgh\s+pr\s+checks\b.*--watch\b/;

/** 1-based lines that merge a PR with no earlier `gh pr checks --watch` in the same text. */
export function unwaitedMerges(text: string): number[] {
  const out: number[] = [];
  let waited = false;
  text.split('\n').forEach((line, i) => {
    if (WAIT.test(line)) waited = true;
    if (MERGE.test(line) && !waited) out.push(i + 1);
  });
  return out;
}
