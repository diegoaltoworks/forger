/**
 * Records one declared capture: a scripted interaction against the served app,
 * written as a video beside the screenshots. The app, the browser and the GIF
 * encoder arrive as ports, so the order of events is tested with fakes.
 */

import {join} from 'path';

import {UiInfrastructureError, type AppServer, type GifEncoder, type Recorder} from '../ports';
import {SCREENSHOT_DIR, UiConfigError, type CaptureSpec, type UiConfig} from './ui-config';

export const FFMPEG_HINT = 'ffmpeg is not installed; the .webm was written, add ffmpeg (for example `apt install ffmpeg` or `brew install ffmpeg`) to also get a GIF';

export interface RecordingPlan {
  spec: CaptureSpec;
  url: string;
  width: number;
  height: number;
  /** Repo-relative paths. */
  video: string;
  gif: string;
}

export interface RecordingReport {
  ok: true;
  name: string;
  files: string[];
}

export function planRecording(config: UiConfig, name: string): RecordingPlan {
  const spec = config.captures.find(c => c.name === name);
  if (spec === undefined) {
    const known = config.captures.map(c => c.name).join(', ');
    throw new UiConfigError(known === '' ? `no capture named "${name}"; declare it under "captures"` : `no capture named "${name}"; declared: ${known}`);
  }
  const viewport = config.viewports.find(v => v.name === spec.viewport);
  if (viewport === undefined) throw new UiConfigError(`capture "${name}" names unknown viewport "${spec.viewport}"`);
  return {
    spec,
    url: `${config.url}${spec.route}`,
    width: viewport.width,
    height: viewport.height,
    video: `${SCREENSHOT_DIR}${name}.webm`,
    gif: `${SCREENSHOT_DIR}${name}.gif`,
  };
}

export async function runRecording(
  config: UiConfig,
  name: string,
  projectRoot: string,
  server: AppServer,
  recorder: Recorder,
  encoder: GifEncoder
): Promise<RecordingReport> {
  const plan = planRecording(config, name);
  let gif = false;
  try {
    await server.start(config.start);
    await server.waitReady(config.url, config.ready_timeout * 1000);
    await recorder.record({
      url: plan.url,
      width: plan.width,
      height: plan.height,
      steps: plan.spec.steps,
      maxSeconds: plan.spec.max_seconds,
      file: join(projectRoot, plan.video),
    });
    gif = await encoder.encode(join(projectRoot, plan.video), join(projectRoot, plan.gif));
  } finally {
    await server.stop();
  }
  if (!gif) throw new UiInfrastructureError('ffmpeg-missing', FFMPEG_HINT);
  return {ok: true, name, files: [plan.video, plan.gif]};
}
