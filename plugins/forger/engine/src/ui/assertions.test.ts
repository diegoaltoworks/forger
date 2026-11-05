import {describe, expect, test} from 'bun:test';

import type {ElementModel, PageModel} from '../ports';
import {DEFAULT_ASSERTIONS, dominantHue, evaluateAssertions, parseAssertions, probeFor, type StateAssertions} from './assertions';

const fail = (m: string): never => {
  throw new Error(m);
};
const parse = (v: unknown): StateAssertions => parseAssertions(v, 'assert', fail);
const only = (over: Partial<StateAssertions>): StateAssertions => ({...DEFAULT_ASSERTIONS, ...over});

const fill = (rgb: [number, number, number], n = 50): ElementModel['pixels'] => Array.from({length: n}, () => rgb);
const el = (over: Partial<ElementModel> = {}): ElementModel => ({found: true, visible: true, box: {x: 0, y: 0, width: 100, height: 100}, pixels: [], ...over});
const page = (elements: Record<string, ElementModel> = {}, console: string[] = []): PageModel => ({viewport: {width: 400, height: 300}, console, elements});

describe('parsing assertions', () => {
  test('none declared means console errors only', () => {
    expect(parse(undefined)).toEqual(DEFAULT_ASSERTIONS);
  });

  test('a selector or a list is accepted and trimmed', () => {
    const a = parse({not_blank: ' canvas ', in_viewport: ['#a', '#b'], hidden: '.banner'});
    expect(a.not_blank).toEqual(['canvas']);
    expect(a.in_viewport).toEqual(['#a', '#b']);
    expect(a.hidden).toEqual(['.banner']);
  });

  test('colour takes a hue name or an arc, with a tolerance', () => {
    const a = parse({colour: [{selector: '.sky', hue: 'blue', tolerance: 15}, {selector: '.sand', hue: [20, 50]}]});
    expect(a.colour.map(c => [c.selector, c.arc, c.tolerance, c.label])).toEqual([
      ['.sky', [200, 260], 15, 'blue'],
      ['.sand', [20, 50], 0, '20-50 degrees'],
    ]);
  });

  test.each([
    [{typo: true}, 'is not an assertion'],
    [{no_console_errors: 'yes'}, 'true or false'],
    [{not_blank: []}, 'non-empty list of selectors'],
    [{visible: [1]}, 'non-empty list of selectors'],
    [{colour: [{selector: '.a', hue: 'beige'}]}, 'hue must be one of'],
    [{colour: [{selector: '.a', hue: [10, 400]}]}, 'hue must be one of'],
    [{colour: [{hue: 'red'}]}, 'one selector'],
    [{colour: [{selector: '.a', hue: 'red', tolerance: -1}]}, 'tolerance'],
    [{visible: '.a', hidden: '.a'}, 'both hidden and shown'],
    [[], 'must be an object'],
  ])('rejects %j', (bad, message) => {
    expect(() => parse(bad)).toThrow(message);
  });

  test('the probe asks for pixels only where a pixel assertion needs them', () => {
    const a = parse({not_blank: 'canvas', visible: '.v', in_viewport: 'canvas', colour: {selector: '.sky', hue: 'blue'}});
    expect(probeFor(a)).toEqual({boxes: ['canvas', '.sky', '.v'], pixels: ['canvas', '.sky']});
  });
});

describe('evaluating assertions', () => {
  test('a clean page passes', () => {
    expect(evaluateAssertions(parse({visible: '.a'}), page({'.a': el()}))).toEqual([]);
  });

  test('console errors fail by default and not when switched off', () => {
    const p = page({}, ['TypeError: x is undefined']);
    expect(evaluateAssertions(parse(undefined), p)).toEqual([{assertion: 'no_console_errors', detail: '1 console error, first: TypeError: x is undefined'}]);
    expect(evaluateAssertions(parse({no_console_errors: false}), p)).toEqual([]);
  });

  test('visible and hidden, including the empty-state banner that shows beside content', () => {
    const p = page({'.list': el({visible: false}), '.banner': el(), '.gone': el({found: false, visible: false, box: null})});
    const out = evaluateAssertions(parse({visible: ['.list', '.nope'], hidden: ['.banner', '.gone']}), p);
    expect(out.map(f => f.assertion)).toEqual(['visible ".list"', 'visible ".nope"', 'hidden ".banner"']);
    expect(out[1].detail).toBe('no element matches');
  });

  test('a canvas cropped at the bottom is outside the viewport and the failure says by how much', () => {
    const p = page({'canvas': el({box: {x: 0, y: 100, width: 400, height: 260}})});
    const [f] = evaluateAssertions(parse({in_viewport: 'canvas'}), p);
    expect(f.assertion).toBe('in_viewport "canvas"');
    expect(f.detail).toContain('60px past the bottom edge');
    expect(f.detail).toContain('400x300 viewport');
  });

  test('a box inside the viewport passes, edges included', () => {
    const p = page({'#v': el({box: {x: 0, y: 0, width: 400, height: 300}})});
    expect(evaluateAssertions(parse({in_viewport: '#v'}), p)).toEqual([]);
  });

  test('a flat canvas is blank; a varied one is not', () => {
    const flat = page({canvas: el({pixels: fill([20, 20, 20])})});
    const varied = page({canvas: el({pixels: [...fill([20, 20, 20]), ...fill([200, 90, 30], 3)]})});
    const a = parse({not_blank: 'canvas'});
    expect(evaluateAssertions(a, flat)[0].detail).toContain('one flat colour');
    expect(evaluateAssertions(a, varied)).toEqual([]);
    expect(evaluateAssertions(a, page({canvas: el({visible: false})}))[0].detail).toBe('no shown element matches');
  });

  test('a desert region rendered green is off-hue; sand is on-hue', () => {
    const a = parse({colour: {selector: '#world', hue: 'orange', tolerance: 10}});
    const green = evaluateAssertions(a, page({'#world': el({pixels: fill([60, 160, 70])})}));
    expect(green).toHaveLength(1);
    expect(green[0].assertion).toBe('colour "#world"');
    expect(green[0].detail).toContain('expected orange');
    expect(evaluateAssertions(a, page({'#world': el({pixels: fill([214, 160, 90])})}))).toEqual([]);
  });

  test('tolerance widens the arc, and red wraps past 360', () => {
    expect(dominantHue(fill([255, 0, 20]))).toBeGreaterThan(340);
    const red = parse({colour: {selector: '#r', hue: 'red'}});
    expect(evaluateAssertions(red, page({'#r': el({pixels: fill([255, 0, 20])})}))).toEqual([]);
    const strict = parse({colour: {selector: '#r', hue: 'green'}});
    expect(evaluateAssertions(strict, page({'#r': el({pixels: fill([255, 0, 20])})}))).toHaveLength(1);
    const loose = parse({colour: {selector: '#r', hue: [20, 50], tolerance: 60}});
    expect(evaluateAssertions(loose, page({'#r': el({pixels: fill([255, 0, 20])})}))).toEqual([]);
  });

  test('a grey region has no dominant hue', () => {
    expect(dominantHue(fill([128, 128, 128]))).toBeNull();
    const [f] = evaluateAssertions(only({colour: [{selector: '#g', label: 'blue', arc: [200, 260], tolerance: 0}]}), page({'#g': el({pixels: fill([128, 128, 128])})}));
    expect(f.detail).toContain('no dominant hue');
  });
});
