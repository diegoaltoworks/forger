import {describe, expect, test} from 'bun:test';

import {BaselineError, approvalTargets, baselinePath, parseBaselines, withApproval, withoutBaseline} from './baselines';
import {planCaptures} from './plan';
import {parseUiConfig} from './ui-config';

const config = parseUiConfig(JSON.stringify({paths: ['src/**'], start: 's', routes: ['/about'], states: [{name: 'empty-cart', route: '/cart'}]}));

describe('baselines', () => {
  test('a state approves every viewport and theme it is captured at', () => {
    expect(approvalTargets(planCaptures(config), 'empty-cart').map(c => c.file)).toEqual([
      'docs/screenshots/empty-cart-phone-light.png',
      'docs/screenshots/empty-cart-phone-dark.png',
      'docs/screenshots/empty-cart-desktop-light.png',
      'docs/screenshots/empty-cart-desktop-dark.png',
    ]);
  });

  test('a route is approved by its slug, and an unknown name approves nothing', () => {
    expect(approvalTargets(planCaptures(config), 'about')).toHaveLength(4);
    expect(approvalTargets(planCaptures(config), 'nope')).toEqual([]);
  });

  test('the approved image is kept under the baseline directory by file name', () => {
    expect(baselinePath('docs/screenshots/a-phone-light.png')).toBe('.forger/ui-baselines/a-phone-light.png');
  });

  test('re-approving replaces the earlier entry of the same name', () => {
    const first = withApproval({approved: []}, {name: 'b', approved_by: 'x', files: ['f1']});
    const second = withApproval(withApproval(first, {name: 'a', approved_by: 'x', files: ['f2']}), {name: 'b', approved_by: 'y', files: ['f3']});
    expect(second.approved).toEqual([
      {name: 'a', approved_by: 'x', files: ['f2']},
      {name: 'b', approved_by: 'y', files: ['f3']},
    ]);
  });

  test('only images without a baseline are left to judge', () => {
    const m = parseBaselines('{"approved":[{"name":"a","approved_by":"o","files":["docs/screenshots/a.png"]}]}');
    expect(withoutBaseline(['docs/screenshots/a.png', 'docs/screenshots/b.png'], m)).toEqual(['docs/screenshots/b.png']);
  });

  test('a malformed manifest is an error, not an empty one', () => {
    expect(() => parseBaselines('nope')).toThrow(BaselineError);
    expect(() => parseBaselines('{}')).toThrow('"approved" list');
    expect(() => parseBaselines('{"approved":[{"name":"a","approved_by":"","files":["f"]}]}')).toThrow('approved[0]');
  });
});
