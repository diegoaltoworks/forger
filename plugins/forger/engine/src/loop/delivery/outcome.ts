import type {TerminalEvent} from '../events';

export type DeliveryOutcome = 'delivered' | 'failed' | 'rolled_back';

export const DELIVERY_FAILED_TITLE = 'Delivery failed after a merge';
export const DELIVERY_LABEL = 'P0';
/** How much of a failing command's output the issue carries. */
export const OUTPUT_TAIL_LINES = 40;

const DELIVERY_EVENTS: readonly string[] = ['delivered', 'delivery_failed', 'rolled_back', 'rollback_failed'];

/** A delivery event names its PR first, so the outcome can be read per PR. */
export function prReason(pr: number | null, detail: string): string {
  return pr === null ? detail : `PR #${pr}: ${detail}`;
}

export function reasonPr(reason: string | null): number | null {
  const m = /^PR #(\d+)\b/.exec(reason ?? '');
  return m === null ? null : Number(m[1]);
}

/** The end of a command's output, which is where a failure says what it was. */
export function tailOf(output: string, lines = OUTPUT_TAIL_LINES): string {
  return output.trimEnd().split('\n').slice(-lines).join('\n');
}

/** What the latest delivery event for `pr` says; null when the PR had no delivery. */
export function deliveryOutcome(events: TerminalEvent[], pr: number): DeliveryOutcome | null {
  let outcome: DeliveryOutcome | null = null;
  for (const e of events) {
    if (!DELIVERY_EVENTS.includes(e.event) || reasonPr(e.reason) !== pr) continue;
    outcome = e.event === 'delivered' ? 'delivered' : e.event === 'rolled_back' ? 'rolled_back' : 'failed';
  }
  return outcome;
}

/** PRs whose delivery failed and that no later successful delivery has made good. */
export function failedDeliveries(events: TerminalEvent[]): number[] {
  const failed: number[] = [];
  for (const e of events) {
    const pr = reasonPr(e.reason);
    if (e.event === 'delivered') failed.length = 0;
    else if (e.event === 'delivery_failed' && pr !== null && !failed.includes(pr)) failed.push(pr);
    else if (e.event === 'rolled_back' && pr !== null) failed.splice(0, failed.length, ...failed.filter(n => n !== pr));
  }
  return failed;
}

export function failureBody(pr: number | null, step: string, detail: string, output: string): string {
  const merged = pr === null ? 'A merged change' : `The change merged in #${pr}`;
  return `${merged} failed its delivery at the ${step} step.\n\n${detail}\n\nThe end of the output:\n\n\`\`\`\n${tailOf(output)}\n\`\`\`\n`;
}
