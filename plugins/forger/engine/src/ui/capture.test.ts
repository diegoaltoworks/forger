import {describe, expect, test} from 'bun:test';

import {UiInfrastructureError, type AppServer, type ShotRequest, type Screenshotter} from '../ports';
import {runScreenshots} from './capture';
import {parseUiConfig} from './ui-config';

const config = parseUiConfig(JSON.stringify({paths: ['a'], start: 'serve it', url: 'http://localhost:9', routes: ['/'], themes: ['light'], ready_timeout: 5}));

function fakes(opts: {readyFails?: boolean; shootFails?: boolean} = {}) {
  const calls: string[] = [];
  let shots: ShotRequest[] = [];
  const server: AppServer = {
    async start(cmd) {
      calls.push(`start ${cmd}`);
    },
    async waitReady(url, ms) {
      calls.push(`wait ${url} ${ms}`);
      if (opts.readyFails) throw new UiInfrastructureError('app-not-ready', 'never answered');
    },
    async stop() {
      calls.push('stop');
    },
  };
  const shooter: Screenshotter = {
    async capture(s) {
      calls.push('capture');
      shots = s;
      if (opts.shootFails) throw new Error('boom');
    },
  };
  return {calls, server, shooter, shots: () => shots};
}

describe('runScreenshots', () => {
  test('starts, waits, captures, stops, and reports the files', async () => {
    const f = fakes();
    const report = await runScreenshots(config, '/repo', f.server, f.shooter);
    expect(f.calls).toEqual(['start serve it', 'wait http://localhost:9 5000', 'capture', 'stop']);
    expect(report.files).toEqual(['docs/screenshots/index-phone-light.png', 'docs/screenshots/index-desktop-light.png']);
    expect(f.shots()[0]).toEqual({url: 'http://localhost:9/', width: 390, height: 844, theme: 'light', file: '/repo/docs/screenshots/index-phone-light.png'});
  });

  test('stops the app when it never answers, and captures nothing', async () => {
    const f = fakes({readyFails: true});
    await expect(runScreenshots(config, '/repo', f.server, f.shooter)).rejects.toThrow('never answered');
    expect(f.calls).toEqual(['start serve it', 'wait http://localhost:9 5000', 'stop']);
  });

  test('stops the app when the capture fails', async () => {
    const f = fakes({shootFails: true});
    await expect(runScreenshots(config, '/repo', f.server, f.shooter)).rejects.toThrow('boom');
    expect(f.calls.at(-1)).toBe('stop');
  });

  test('steps of a state travel with its shot, and a plain route carries none', async () => {
    const withState = parseUiConfig(JSON.stringify({
      paths: ['a'], start: 's', url: 'http://localhost:9', routes: ['/'], themes: ['light'], viewports: [{name: 'phone', width: 1, height: 2}],
      states: [{name: 'filtered', route: '/list?f=1', steps: [{click: '#f'}, {fill: {selector: '#q', value: 'x'}}]}],
    }));
    const f = fakes();
    const report = await runScreenshots(withState, '/repo', f.server, f.shooter);
    expect(report.files).toEqual(['docs/screenshots/index-phone-light.png', 'docs/screenshots/filtered-phone-light.png']);
    expect(f.shots()[0]).not.toHaveProperty('steps');
    expect(f.shots()[1]).toEqual({
      url: 'http://localhost:9/list?f=1', width: 1, height: 2, theme: 'light',
      steps: [{click: '#f'}, {fill: {selector: '#q', value: 'x'}}], file: '/repo/docs/screenshots/filtered-phone-light.png',
    });
  });
});
