import {expect, test} from 'bun:test';

import type {AppServer, PageModel, Screenshotter} from '../../ports';
import {parseUiConfig} from '../../ui';
import {runStatesCheck} from './states-check';

const config = parseUiConfig(
  JSON.stringify({paths: ['a'], start: 's', url: 'http://localhost:9', themes: ['light'], viewports: [{name: 'phone', width: 400, height: 300}], states: [{name: 'world', assert: {visible: '.hud'}}]})
);
const server: AppServer = {async start() {}, async waitReady() {}, async stop() {}};

test('a failed assertion becomes a finding naming the state, assertion, viewport and theme', async () => {
  const page: PageModel = {viewport: {width: 400, height: 300}, console: [], elements: {'.hud': {found: true, visible: false, box: null, pixels: []}}};
  const shooter: Screenshotter = {async capture() { return [page]; }};
  expect(await runStatesCheck(config, server, shooter)).toEqual([
    {file: 'world', line: 1, rule: 'visible ".hud"', opinion: 'ui.assertions', detail: 'the element is not shown (phone, light)'},
  ]);
});
