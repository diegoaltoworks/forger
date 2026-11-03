/**
 * Reads the output of the `slcr` binary into the normalized requirement
 * report. Pure: the text in, a report or a `SpecOutputError` naming the field
 * out. The shapes are those of `slcr check --format json` and
 * `slcr query --format json`; anything else is refused rather than guessed.
 */

import {SpecOutputError, type RequirementModality, type RequirementState, type RequirementStatus, type SpecReport} from '../ports';

type Json = Record<string, unknown>;

const STATES: RequirementState[] = ['satisfied', 'unsatisfied', 'unknown'];

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new SpecOutputError(`${what}: output is not JSON`);
  }
}

function object(value: unknown, path: string): Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SpecOutputError(`${path} is missing or not an object`);
  return value as Json;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new SpecOutputError(`${path} is missing or not an array`);
  return value;
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value === '') throw new SpecOutputError(`${path} is missing or not a string`);
  return value;
}

/** "MUST NOT" binds like MUST and "SHOULD NOT" like SHOULD. */
export function toModality(raw: string, path: string): RequirementModality {
  switch (raw) {
    case 'MUST':
    case 'MUST NOT':
      return 'MUST';
    case 'SHOULD':
    case 'SHOULD NOT':
      return 'SHOULD';
    case 'MAY':
      return 'MAY';
    default:
      throw new SpecOutputError(`${path} is not a known modality: ${raw}`);
  }
}

export interface CheckedSpec {
  file: string;
  requirements: Array<{id: string; state: RequirementState}>;
}

/** The specs of a `check --format json` document, with each requirement's state. */
export function parseCheckSpecs(text: string): CheckedSpec[] {
  const doc = object(parseJson(text, 'slcr check'), 'slcr check');
  const vet = doc.vet === undefined ? undefined : object(doc.vet, 'vet');
  if (doc.specs === undefined) {
    if (vet !== undefined && vet.passed === false) throw new SpecOutputError('the project does not vet cleanly (vet.passed is false), so no requirement was checked');
    if (doc.interrupted === true) throw new SpecOutputError('check was interrupted (interrupted is true), so no requirement was checked');
    throw new SpecOutputError('specs is missing');
  }
  return array(doc.specs, 'specs').map((raw, i) => {
    const spec = object(raw, `specs[${i}]`);
    const file = string(spec.file, `specs[${i}].file`);
    const requirements = array(spec.requirements, `specs[${i}].requirements`).map((r, j) => {
      const req = object(r, `specs[${i}].requirements[${j}]`);
      const status = string(req.status, `specs[${i}].requirements[${j}].status`);
      if (!STATES.includes(status as RequirementState)) throw new SpecOutputError(`specs[${i}].requirements[${j}].status is not satisfied, unsatisfied or unknown: ${status}`);
      return {id: string(req.id, `specs[${i}].requirements[${j}].id`), state: status as RequirementState};
    });
    return {file, requirements};
  });
}

/** The query that lists every requirement with its modality; the output is read by `parseModalities`. */
export const MODALITY_QUERY = 'MATCH (r:Requirement) RETURN r.id, r.modality';

/** id -> modality from a `query --format json` document of `MODALITY_QUERY`. */
export function parseModalities(text: string): Map<string, RequirementModality> {
  const doc = object(parseJson(text, 'slcr query'), 'slcr query');
  const columns = array(doc.columns, 'columns');
  if (columns[0] !== 'r.id' || columns[1] !== 'r.modality') throw new SpecOutputError(`columns is not [r.id, r.modality]: ${JSON.stringify(columns)}`);
  const out = new Map<string, RequirementModality>();
  array(doc.rows, 'rows').forEach((row, i) => {
    const cells = array(row, `rows[${i}]`);
    out.set(string(cells[0], `rows[${i}][0]`), toModality(string(cells[1], `rows[${i}][1]`), `rows[${i}][1]`));
  });
  return out;
}

/** Joins a spec's states with its modalities; a requirement with no modality is a changed shape. */
export function buildReport(specs: Array<{spec: CheckedSpec; modalities: Map<string, RequirementModality>}>): SpecReport {
  const seen = new Set<string>();
  const requirements: RequirementStatus[] = [];
  for (const {spec, modalities} of specs) {
    for (const r of spec.requirements) {
      const modality = modalities.get(r.id);
      if (modality === undefined) throw new SpecOutputError(`requirement ${r.id} of ${spec.file} has no modality in the query output (rows)`);
      if (seen.has(r.id)) throw new SpecOutputError(`requirement id ${r.id} appears in more than one spec (specs[].requirements[].id)`);
      seen.add(r.id);
      requirements.push({id: r.id, modality, state: r.state});
    }
  }
  return {requirements};
}
