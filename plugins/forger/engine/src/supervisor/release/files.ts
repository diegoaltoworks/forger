/** Reading, writing and checking the version in the configured files. Pure over an injected file port. */

import {firstEntryVersion} from './changelog';

export interface ReleaseFile {
  path: string;
  key: string;
}

export interface FilePort {
  read(path: string): string | null;
  write(path: string, text: string): void;
}

export function versionIn(text: string, key: string): string | null {
  try {
    const v = (JSON.parse(text) as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Every file's version; throws naming a file that is missing or holds no string at its key. */
export function readVersions(files: ReleaseFile[], fs: FilePort): {path: string; version: string}[] {
  return files.map(f => {
    const text = fs.read(f.path);
    if (text === null) throw new Error(`${f.path} does not exist`);
    const version = versionIn(text, f.key);
    if (version === null) throw new Error(`${f.path} holds no string at "${f.key}"`);
    return {path: f.path, version};
  });
}

/** The text with the key's value replaced, the rest of the file as it was. */
export function withVersion(text: string, key: string, version: string): string | null {
  const pattern = new RegExp(`("${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*)"[^"]*"`);
  return pattern.test(text) ? text.replace(pattern, (_m, head: string) => `${head}"${version}"`) : null;
}

export function writeVersions(files: ReleaseFile[], version: string, fs: FilePort): void {
  for (const f of files) {
    const text = fs.read(f.path);
    const next = text === null ? null : withVersion(text, f.key, version);
    if (next === null) throw new Error(`${f.path} has no "${f.key}" to write`);
    fs.write(f.path, next);
  }
}

/** What differs from `version`: each file that holds another, and the changelog when its first entry is for another. */
export function checkVersions(files: ReleaseFile[], changelog: string, version: string, fs: FilePort): string[] {
  const out: string[] = [];
  for (const f of files) {
    const text = fs.read(f.path);
    const held = text === null ? null : versionIn(text, f.key);
    if (held !== version) out.push(`${f.path} holds ${held ?? 'no version'}, not ${version}`);
  }
  const first = firstEntryVersion(fs.read(changelog));
  if (first !== version) out.push(`${changelog} starts with ${first === null ? 'no entry' : first}, not ${version}`);
  return out;
}
