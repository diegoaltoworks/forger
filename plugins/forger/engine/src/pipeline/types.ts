/** The pipeline definition (ADR 0016): stages in order, the slots each runs and the gate after it. */

export interface Condition {
  labels_any?: string[];
  labels_none?: string[];
  /** Globs over the ticket's knock-on paths. */
  paths_any?: string[];
  /** Opinion packs that must all be installed. */
  packs_all?: string[];
}

export interface StageSlot {
  slot: string;
  contract: string;
  /** Runs only when this event happens in the stage (a red gate, a conflicting rebase). */
  on?: string;
  /** Runs only for the tickets this condition matches. */
  when?: Condition;
}

export interface Stage {
  id: string;
  command: string;
  inputs: string[];
  slots: StageSlot[];
  gate: string;
}

export interface Definition {
  version: number;
  stages: Stage[];
}

/** What a project may change: disable a stage, add a slot to a stage, replace a gate. */
export interface Overlay {
  disable?: string[];
  add?: Array<{stage: string; slot: StageSlot}>;
  gates?: Record<string, string>;
}

/** The facts of one ticket a slot's condition reads. */
export interface TicketFacts {
  id: string | null;
  labels: string[];
  paths: string[];
  packs: string[];
}

export const NO_TICKET: TicketFacts = {id: null, labels: [], paths: [], packs: []};

/** One choice for a slot: a skill by name or a file to follow, used when its conditions hold and it is installed. */
export interface Candidate {
  skill?: string;
  file?: string;
  when?: Condition;
}

/**
 * A named, versioned selection over the pipeline (ADR 0016 section 4): per slot an ordered list of
 * candidates. The built-in step is the implicit last candidate. The collection fields describe the
 * skill collection a flavour maps, so setup can offer it and the worker can be told what not to invoke.
 */
export interface Flavour {
  name: string;
  version: number;
  description: string;
  slots: Record<string, Candidate[]>;
  collection?: string;
  plugin?: string;
  aliases?: string[];
  forbid?: string[];
}
