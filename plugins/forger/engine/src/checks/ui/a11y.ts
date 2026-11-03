/**
 * `ui.a11y`: serious and critical axe violations fail. Mapping axe's output to
 * findings is pure; running axe is the adapter's job.
 */

import type {AuditedPage, AxeViolation} from '../../ports';
import {routeOf} from '../../ui';
import type {Finding} from '../waivers';

export const A11Y_OPINION = 'ui.a11y';

const BLOCKING = new Set(['serious', 'critical']);

export function isBlocking(v: AxeViolation): boolean {
  return v.impact !== null && BLOCKING.has(v.impact);
}

export function axeFindings(pages: AuditedPage[], base: string): Finding[] {
  return pages.flatMap(({request, results}) =>
    results.violations.filter(isBlocking).map(
      (v): Finding => ({
        file: routeOf(request.url, base),
        line: 1,
        rule: v.id,
        opinion: A11Y_OPINION,
        detail: `${v.impact}: ${v.help} (${v.nodes.length} element${v.nodes.length === 1 ? '' : 's'}, e.g. ${String(v.nodes[0]?.target?.[0] ?? 'unknown')}; ${request.width}px, ${request.theme})`,
      })
    )
  );
}
