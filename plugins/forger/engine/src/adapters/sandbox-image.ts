/**
 * Which image the `docker` sandbox runs in. Forger ships none: the image is
 * the repository's own `.devcontainer/` image, else the one the config names.
 * The engine builds only what the repository's own devcontainer describes.
 */

import {existsSync, readFileSync} from 'fs';
import {join} from 'path';

import type {CapturingRunner} from '../ports';
import {imagePlan, repoKey, type DevcontainerFile, type ImagePlan} from './docker-plan';

export const SAMPLES_PATH = 'examples/sandbox/';

/** What to tell a user whose docker sandbox has no image. */
export const NO_IMAGE =
  `the docker sandbox has no image: put one in the repository's .devcontainer/ (an "image", or a "build" with a Dockerfile), or name one with "sandbox_image" in the config. ` +
  `Forger ships no image; samples to copy are under ${SAMPLES_PATH} in the forger repository, and "check sandbox" tests an image against the contract`;

export const NO_ENGINE_IMAGE =
  'the docker sandbox has no engine image to detach in: name one with "sandbox_engine_image" in the config (the image contract plus the docker CLI)';

function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function readDevcontainer(root: string): {file: DevcontainerFile | null; dockerfile: boolean} {
  const inDir = join(root, '.devcontainer', 'devcontainer.json');
  const flat = join(root, '.devcontainer.json');
  const file = existsSync(inDir) ? {dir: '.devcontainer', text: readFileSync(inDir, 'utf-8')} : existsSync(flat) ? {dir: '', text: readFileSync(flat, 'utf-8')} : null;
  return {file, dockerfile: existsSync(join(root, '.devcontainer', 'Dockerfile'))};
}

export function planSandboxImage(projectRoot: string, configured: string | null | undefined, origin: string): ImagePlan {
  const found = readDevcontainer(projectRoot);
  return imagePlan(found.file, found.dockerfile, configured ?? null, `forger-sandbox:${repoKey(origin)}`);
}

/** The image to run in, building the repository's own devcontainer Dockerfile when that is what it names. */
export function resolveSandboxImage(git: CapturingRunner, projectRoot: string, configured: string | null | undefined, origin: string): {image: string} | {error: string} {
  const plan = planSandboxImage(projectRoot, configured, origin);
  if (plan.kind === 'none') return {error: NO_IMAGE};
  if (plan.kind === 'image') return {image: plan.image};
  const context = plan.context.startsWith('/') ? plan.context : join(projectRoot, plan.context);
  const dockerfile = plan.dockerfile.startsWith('/') ? plan.dockerfile : join(projectRoot, plan.dockerfile);
  const built = git(`docker build -q -t ${quote(plan.tag)} -f ${quote(dockerfile)} ${quote(context)}`);
  if (built.exitCode !== 0) return {error: `docker build of ${plan.tag} failed: ${built.stderr || built.stdout}`};
  return {image: plan.tag};
}
