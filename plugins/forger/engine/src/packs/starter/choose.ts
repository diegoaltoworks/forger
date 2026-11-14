/**
 * Which starter, if any, `setup` copies. The decision is pure over plain data;
 * the reading of the plugin's starters and of the repository is in `install.ts`.
 */

export interface StarterManifest {
  name: string;
  description: string;
  /** The gates the starter's own scripts answer to; `setup` records them in the config. */
  gates: string;
  /** The packs the starter is configured for, installed on top of the ones chosen. */
  packs: string[];
}

export interface StarterRequest {
  /** True when the repository has a file the structure pack counts as source. */
  hasSource: boolean;
  noStarter: boolean;
  /** The name given with `--starter`. */
  wanted?: string;
  available: StarterManifest[];
}

export type StarterChoice = {kind: 'none'} | {kind: 'use'; starter: StarterManifest};

/** The default is the first starter, and only for a repository with no source. A name asked for is honoured wherever it is and fails loudly when unknown. */
export function chooseStarter(req: StarterRequest): StarterChoice {
  if (req.noStarter) return {kind: 'none'};
  if (req.wanted !== undefined) {
    const found = req.available.find(s => s.name === req.wanted);
    if (!found) throw new Error(`Unknown starter: ${req.wanted}. Starters: ${req.available.map(s => s.name).join(', ') || 'none'}`);
    return {kind: 'use', starter: found};
  }
  const first = req.available[0];
  return req.hasSource || !first ? {kind: 'none'} : {kind: 'use', starter: first};
}

/** The chosen packs followed by the starter's, once each. */
export function withStarterPacks(chosen: string[], starter: StarterManifest): string[] {
  return [...new Set([...chosen, ...starter.packs])];
}
