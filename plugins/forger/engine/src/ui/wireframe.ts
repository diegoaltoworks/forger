/**
 * The design slot's built-in step, as a decision: where a ticket's wireframe
 * lives and the capture config that photographs it. Pure; serving the folder is
 * the static server adapter's job.
 */

import type {UiConfig} from './ui-config';

export const DESIGN_DIR = 'docs/design/';
export const WIREFRAME_STYLESHEET = `${DESIGN_DIR}wireframe.css`;

const TICKET = /^[a-z0-9]+(?:[a-z0-9._-]*[a-z0-9])?$/;

export class WireframeError extends Error {}

export interface WireframePlan {
  /** Repo-relative folder holding the ticket's index.html; also where the images land. */
  dir: string;
  /** The folder the static server serves: all of docs/design/, so the page reaches the shared stylesheet. */
  root: string;
  /** The wireframe page inside `root`. */
  page: string;
  /** Capture config: one route, the project's viewports, light only (a wireframe has no brand to theme). */
  config: UiConfig;
}

export function wireframePlan(base: UiConfig, ticket: string, port: number): WireframePlan {
  if (!TICKET.test(ticket) || ticket.includes('..')) {
    throw new WireframeError(`ticket "${ticket}" must be lowercase letters, digits, hyphens, dots or underscores, such as issue-44`);
  }
  const dir = `${DESIGN_DIR}${ticket}/`;
  return {
    dir,
    root: DESIGN_DIR,
    page: `${ticket}/index.html`,
    config: {...base, start: 'static', url: `http://127.0.0.1:${port}`, routes: [`/${ticket}/`], themes: ['light']},
  };
}
