/**
 * The shapes `screenshot` is written against: an app that can be started and
 * waited for, and a browser that captures pages. `adapters/` implements them;
 * tests use fakes.
 */

export interface ShotRequest {
  url: string;
  width: number;
  height: number;
  theme: 'light' | 'dark';
  /** Absolute path of the image to write. */
  file: string;
}

export interface Screenshotter {
  capture(shots: ShotRequest[]): Promise<void>;
}

export interface AppServer {
  /** Starts the app's serve command; resolves once the process is running. */
  start(command: string): Promise<void>;
  /** Resolves when the url answers; rejects when the app exits or the deadline passes. */
  waitReady(url: string, timeoutMs: number): Promise<void>;
  /** Ends the app and everything it started. Safe to call when it never started. */
  stop(): Promise<void>;
}

/**
 * The environment cannot take screenshots: the browser library is missing, or
 * the app never came up. The project's code did not fail, so callers report it
 * apart from a bad config.
 */
export class UiInfrastructureError extends Error {
  readonly category: 'playwright-missing' | 'app-not-ready';
  constructor(category: 'playwright-missing' | 'app-not-ready', message: string) {
    super(message);
    this.category = category;
  }
}
