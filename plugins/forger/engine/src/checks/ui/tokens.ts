/**
 * `ui.tokens`: colours come from the design tokens, not from literals written
 * into components. Detection is pure over file contents; comments are blanked
 * first so prose about a colour is not a colour.
 */

import {SCREENSHOT_DIR, type UiConfig} from '../../ui';
import {globToRegExp, type Finding} from '../waivers';

export const TOKENS_OPINION = 'ui.tokens';

/** Files whose colours are worth checking; images and fonts under public/ are not text. */
const SCANNED = /\.(css|scss|sass|less|tsx|jsx|ts|js|vue|svelte|html)$/;

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g;
const FUNCTION = /\b(?:rgba?|hsla?)\(/gi;

export interface ColourLiteral {
  line: number;
  text: string;
}

/** Replaces comment text with spaces, keeping every newline, so line numbers survive. */
export function blankComments(source: string): string {
  const blank = (m: string): string => m.replace(/[^\n]/g, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(^|[^:\w"'`\\])\/\/[^\n]*/g, (m, lead: string) => lead + blank(m.slice(lead.length)));
}

export function findColourLiterals(source: string): ColourLiteral[] {
  const found: ColourLiteral[] = [];
  blankComments(source)
    .split('\n')
    .forEach((text, i) => {
      for (const m of text.matchAll(HEX)) found.push({line: i + 1, text: m[0]});
      for (const m of text.matchAll(FUNCTION)) found.push({line: i + 1, text: m[0] + '...)'});
    });
  return found;
}

export interface UiSourceFile {
  path: string;
  content: string;
}

/** The files `ui.tokens` looks at: UI files that are neither token files nor screenshots. */
export function tokenScanTargets(paths: string[], config: UiConfig): string[] {
  const ui = config.paths.map(globToRegExp);
  const tokens = config.tokens.map(globToRegExp);
  return paths.filter(p => !p.startsWith(SCREENSHOT_DIR) && SCANNED.test(p) && ui.some(re => re.test(p)) && !tokens.some(re => re.test(p)));
}

export function checkTokens(files: UiSourceFile[]): Finding[] {
  return files.flatMap(f =>
    findColourLiterals(f.content).map(
      (l): Finding => ({
        file: f.path,
        line: l.line,
        rule: 'raw-colour-literal',
        opinion: TOKENS_OPINION,
        detail: `${l.text} is a raw colour; use a design token (or define it in a token file)`,
      })
    )
  );
}
