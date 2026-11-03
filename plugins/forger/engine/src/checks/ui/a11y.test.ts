import {describe, expect, test} from 'bun:test';

import type {AuditedPage, AxeViolation} from '../../ports';
import {axeFindings, isBlocking} from './a11y';

/** Trimmed from a real axe-core run: contrast fails seriously, a landmark rule is only moderate. */
const RECORDED: AxeViolation[] = [
  {id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds', nodes: [{target: ['.cta']}, {target: ['.foot']}]},
  {id: 'region', impact: 'moderate', help: 'All page content should be contained by landmarks', nodes: [{target: ['p']}]},
  {id: 'image-alt', impact: 'critical', help: 'Images must have alternate text', nodes: [{target: ['img.hero']}]},
  {id: 'tabindex', impact: 'minor', help: 'Elements should not have tabindex greater than zero', nodes: [{target: ['a']}]},
];
const page = (url: string, violations: AxeViolation[], width = 390): AuditedPage => ({request: {url, width, height: 800, theme: 'light'}, results: {violations}});

describe('axeFindings', () => {
  test('only serious and critical violations become findings', () => {
    const findings = axeFindings([page('http://app/about', RECORDED)], 'http://app');
    expect(findings.map(f => f.rule)).toEqual(['color-contrast', 'image-alt']);
    expect(findings[0]).toMatchObject({file: '/about', line: 1, opinion: 'ui.a11y'});
    expect(findings[0].detail).toContain('2 elements');
    expect(findings[0].detail).toContain('.cta');
    expect(findings[0].detail).toContain('390px, light');
    expect(findings[1].detail).toContain('1 element,');
  });
  test('a clean page, and a page with only minor issues, pass', () => {
    expect(axeFindings([page('http://app/', []), page('http://app/', [RECORDED[1], RECORDED[3]])], 'http://app')).toEqual([]);
  });
  test('the root route is named /', () => {
    expect(axeFindings([page('http://app', [RECORDED[0]])], 'http://app')[0].file).toBe('/');
  });
  test('an unknown impact does not block', () => {
    expect(isBlocking({id: 'x', impact: null, help: '', nodes: []})).toBe(false);
  });
});
