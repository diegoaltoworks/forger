/**
 * The pure half of a sandboxed run's credentials (ADR 0019): which variables carry the model credential
 * for a harness and a kind, which GitHub repository a token is scoped to, and the redaction of secret
 * values from anything the engine records. Nothing here reads the environment or the network.
 */

import {createSign} from 'crypto';

import type {CredentialKind, WorkloopConfig} from '../config';
import type {Harness} from '../ports';

export type ModelCredential = {ok: true; variables: string[]} | {ok: false; error: string};

/**
 * The variables the harness's CLI reads for `kind`. A harness with no documented variable for the kind is
 * refused with the reason, and the other kind is named when it works.
 */
export function modelCredential(harness: Harness, kind: CredentialKind): ModelCredential {
  const variables = kind === 'api_key' ? harness.credentials.api_key : harness.credentials.subscription ? [harness.credentials.subscription] : [];
  if (variables.length > 0) return {ok: true, variables};
  const other: CredentialKind = kind === 'api_key' ? 'subscription' : 'api_key';
  const otherWorks = modelCredentialExists(harness, other);
  return {
    ok: false,
    error: `the ${harness.id} harness documents no variable for a ${kind} credential in a sandbox${otherWorks ? `; use ${other}` : ''} (see the credentials table in docs/reference/adapters.md)`,
  };
}

function modelCredentialExists(harness: Harness, kind: CredentialKind): boolean {
  return kind === 'api_key' ? harness.credentials.api_key.length > 0 : harness.credentials.subscription !== null;
}

/** Every variable the harness can read a model credential from; used when the config names no kind. */
export function allModelVariables(harness: Harness): string[] {
  return [...harness.credentials.api_key, ...(harness.credentials.subscription ? [harness.credentials.subscription] : [])];
}

/** `owner` and `name` of a GitHub remote, in either the https or the ssh form; null for any other host or shape. */
export function repoSlug(origin: string): {owner: string; name: string} | null {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|(?:ssh:\/\/)?git@github\.com[:/])([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(origin.trim());
  return m ? {owner: m[1], name: m[2]} : null;
}

/** Secrets shorter than this are not scanned for: they would redact ordinary words. */
export const MIN_SECRET_LENGTH = 6;

/** Replaces every occurrence of each secret value in `text`. Longer values go first so one that contains another is whole. */
export function redact(text: string, secrets: Iterable<string>): string {
  const values = [...new Set(secrets)].filter(s => s.length >= MIN_SECRET_LENGTH).sort((a, b) => b.length - a.length);
  return values.reduce((out, s) => out.split(s).join('[redacted]'), text);
}

const b64url = (b: Buffer | string): string => Buffer.from(b).toString('base64url');

/** The RS256 JWT a GitHub App signs to authenticate as itself; valid for under the ten minutes GitHub allows. */
export function appJwt(appId: string, privateKeyPem: string, nowSeconds: number): string {
  const head = b64url(JSON.stringify({alg: 'RS256', typ: 'JWT'}));
  const body = b64url(JSON.stringify({iat: nowSeconds - 60, exp: nowSeconds + 9 * 60, iss: appId}));
  const signature = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKeyPem);
  return `${head}.${body}.${b64url(signature)}`;
}

/** What a run is given, worked out from the config and the harness. */
export interface CredentialPlan {
  github: WorkloopConfig['credentials']['github'];
  /** The model credential variables the container receives by name. */
  variables: string[];
  /** Why the configured kind cannot be used with this harness, or null. */
  error: string | null;
}

export function credentialPlan(config: Pick<WorkloopConfig, 'credentials'>, harness: Harness): CredentialPlan {
  const kind = config.credentials.model[harness.id];
  if (!kind) return {github: config.credentials.github, variables: allModelVariables(harness), error: null};
  const chosen = modelCredential(harness, kind);
  return chosen.ok ? {github: config.credentials.github, variables: chosen.variables, error: null} : {github: config.credentials.github, variables: [], error: chosen.error};
}
