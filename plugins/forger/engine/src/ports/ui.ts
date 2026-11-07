/**
 * The shapes `screenshot` is written against: an app that can be started and
 * waited for, and a browser that captures pages. `adapters/` implements them;
 * tests use fakes.
 */

/** One scripted interaction. `wait`, `click` and `tap` take a CSS selector, `fill` a selector and the text to type, `key` a Playwright key name, `pause` milliseconds. */
export type CaptureStep = {wait: string} | {key: string} | {click: string} | {tap: string} | {pause: number} | {fill: {selector: string; value: string}};

export interface ShotRequest {
  url: string;
  width: number;
  height: number;
  theme: 'light' | 'dark';
  /** The language the page is captured in, and its writing direction; the page runs with `dir` set on its root. */
  locale?: string;
  dir?: 'ltr' | 'rtl';
  /** Run in order after the page loads and before the capture; a named UI state's setup. */
  steps?: CaptureStep[];
  /** Absolute path of the image to write; none means the page is only probed. */
  file?: string;
  /** What to measure on the page after the steps; the answer comes back as a `PageModel`. */
  probe?: Probe;
}

/** The selectors a page model must describe. */
export interface Probe {
  /** Selectors whose box and visibility are read. */
  boxes: string[];
  /** Selectors whose pixels are sampled; a subset of `boxes` in practice. */
  pixels: string[];
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementModel {
  found: boolean;
  /** Rendered: not display none, not visibility hidden, a box with area. */
  visible: boolean;
  box: Box | null;
  /** Sampled RGB triples (0-255) of the visible part of the element; empty when not sampled. */
  pixels: Array<[number, number, number]>;
}

/** What the page showed: its console errors and the probed elements. */
export interface PageModel {
  viewport: {width: number; height: number};
  /** Console error and uncaught exception lines. */
  console: string[];
  elements: Record<string, ElementModel>;
}

export interface Screenshotter {
  /** Resolves one `PageModel` per shot, in order, for the shots that asked for a probe; a screenshotter that probes nothing may resolve nothing. */
  capture(shots: ShotRequest[]): Promise<Array<PageModel | undefined> | void>;
}

export interface RecordRequest {
  url: string;
  width: number;
  height: number;
  steps: CaptureStep[];
  maxSeconds: number;
  /** Absolute path of the .webm to write. */
  file: string;
}

export interface Recorder {
  record(request: RecordRequest): Promise<void>;
}

/** Turns a recorded video into a GIF beside it. */
export interface GifEncoder {
  /** Resolves false when no encoder is installed, so the caller can say how to add one. */
  encode(video: string, gif: string): Promise<boolean>;
}

export interface AppServer {
  /** Starts the app's serve command; resolves once the process is running. */
  start(command: string): Promise<void>;
  /** Resolves when the url answers; rejects when the app exits or the deadline passes. */
  waitReady(url: string, timeoutMs: number): Promise<void>;
  /** Ends the app and everything it started. Safe to call when it never started. */
  stop(): Promise<void>;
}

export type AxeImpact = 'minor' | 'moderate' | 'serious' | 'critical';

/** The part of axe-core's output the check reads. */
export interface AxeViolation {
  id: string;
  impact: AxeImpact | null;
  help: string;
  nodes: Array<{target: unknown[]}>;
}

export interface AxeResults {
  violations: AxeViolation[];
}

export interface AuditRequest {
  url: string;
  width: number;
  height: number;
  theme: 'light' | 'dark';
}

export interface AuditedPage {
  request: AuditRequest;
  results: AxeResults;
}

export interface AccessibilityAuditor {
  audit(pages: AuditRequest[]): Promise<AuditedPage[]>;
}

/**
 * The environment cannot take screenshots: the browser library is missing, or
 * the app never came up. The project's code did not fail, so callers report it
 * apart from a bad config.
 */
export class UiInfrastructureError extends Error {
  readonly category: 'playwright-missing' | 'axe-missing' | 'app-not-ready' | 'ffmpeg-missing';
  constructor(category: 'playwright-missing' | 'axe-missing' | 'app-not-ready' | 'ffmpeg-missing', message: string) {
    super(message);
    this.category = category;
  }
}
