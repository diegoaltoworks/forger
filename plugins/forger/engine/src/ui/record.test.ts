import {describe, expect, test} from 'bun:test';

import {UiInfrastructureError, type AppServer, type GifEncoder, type RecordRequest, type Recorder} from '../ports';
import {FFMPEG_HINT, planRecording, runRecording} from './record';
import {UiConfigError, parseUiConfig} from './ui-config';

const config = parseUiConfig(
  JSON.stringify({
    paths: ['a'],
    start: 'serve it',
    url: 'http://localhost:9',
    ready_timeout: 5,
    captures: [{name: 'play', route: '/game', viewport: 'desktop', max_seconds: 20, steps: [{wait: '#go'}, {key: 'Space'}, {pause: 300}]}],
  })
);

function fakes(opts: {ffmpeg?: boolean; recordFails?: boolean} = {}) {
  const calls: string[] = [];
  let request: RecordRequest | undefined;
  const server: AppServer = {
    async start(cmd) {
      calls.push(`start ${cmd}`);
    },
    async waitReady(url, ms) {
      calls.push(`wait ${url} ${ms}`);
    },
    async stop() {
      calls.push('stop');
    },
  };
  const recorder: Recorder = {
    async record(r) {
      calls.push('record');
      request = r;
      if (opts.recordFails) throw new Error('boom');
    },
  };
  const encoder: GifEncoder = {
    async encode(video, gif) {
      calls.push(`encode ${video} ${gif}`);
      return opts.ffmpeg ?? true;
    },
  };
  return {calls, server, recorder, encoder, request: () => request};
}

describe('planRecording', () => {
  test('names the video and gif beside the screenshots and takes the declared viewport', () => {
    expect(planRecording(config, 'play')).toMatchObject({url: 'http://localhost:9/game', width: 1280, height: 800, video: 'docs/screenshots/play.webm', gif: 'docs/screenshots/play.gif'});
  });

  test('an undeclared name lists the declared ones', () => {
    expect(() => planRecording(config, 'nope')).toThrow('declared: play');
  });

  test('a config with no captures says where to declare one', () => {
    const none = parseUiConfig(JSON.stringify({paths: ['a'], start: 's'}));
    expect(() => planRecording(none, 'play')).toThrow(UiConfigError);
    expect(() => planRecording(none, 'play')).toThrow('declare it under "captures"');
  });
});

describe('runRecording', () => {
  test('starts the app, records the declared steps, encodes a gif and stops the app', async () => {
    const f = fakes();
    const report = await runRecording(config, 'play', '/root', f.server, f.recorder, f.encoder);
    expect(f.calls).toEqual(['start serve it', 'wait http://localhost:9 5000', 'record', 'encode /root/docs/screenshots/play.webm /root/docs/screenshots/play.gif', 'stop']);
    expect(f.request()).toEqual({
      url: 'http://localhost:9/game',
      width: 1280,
      height: 800,
      steps: [{wait: '#go'}, {key: 'Space'}, {pause: 300}],
      maxSeconds: 20,
      file: '/root/docs/screenshots/play.webm',
    });
    expect(report).toEqual({ok: true, name: 'play', files: ['docs/screenshots/play.webm', 'docs/screenshots/play.gif']});
  });

  test('without ffmpeg the video is still recorded, then the run is an infrastructure error with the how-to', async () => {
    const f = fakes({ffmpeg: false});
    const err = await runRecording(config, 'play', '/root', f.server, f.recorder, f.encoder).catch(e => e);
    expect(err).toBeInstanceOf(UiInfrastructureError);
    expect(err.category).toBe('ffmpeg-missing');
    expect(err.message).toBe(FFMPEG_HINT);
    expect(f.calls).toContain('record');
    expect(f.calls.at(-1)).toBe('stop');
  });

  test('stops the app when the recording fails and does not encode', async () => {
    const f = fakes({recordFails: true});
    await expect(runRecording(config, 'play', '/root', f.server, f.recorder, f.encoder)).rejects.toThrow('boom');
    expect(f.calls).toEqual(['start serve it', 'wait http://localhost:9 5000', 'record', 'stop']);
  });

  test('an undeclared capture never starts the app', async () => {
    const f = fakes();
    await expect(runRecording(config, 'nope', '/root', f.server, f.recorder, f.encoder)).rejects.toThrow(UiConfigError);
    expect(f.calls).toEqual([]);
  });
});
