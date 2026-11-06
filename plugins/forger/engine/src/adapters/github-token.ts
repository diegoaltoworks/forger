/**
 * The one GitHub token a sandboxed run gets, scoped to its repository: read from a variable, or minted
 * from a GitHub App installation for that repository alone, so it expires on its own. The network is the
 * injected `GithubApi`; the real one is `fetchGithubApi`.
 */

import type {WorkloopConfig} from '../config';
import {appJwt, repoSlug} from './credentials';

export interface GithubResponse {
  status: number;
  body: unknown;
}

export interface GithubApi {
  request(method: 'GET' | 'POST', path: string, bearer: string, body?: unknown): Promise<GithubResponse>;
}

export const fetchGithubApi: GithubApi = {
  async request(method, path, bearer, body) {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {Authorization: `Bearer ${bearer}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'forger'},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {status: res.status, body: await res.json().catch(() => null)};
  },
};

export type TokenResult = {ok: true; token: string | null} | {ok: false; error: string};

export interface TokenInput {
  github: WorkloopConfig['credentials']['github'];
  env: Record<string, string | undefined>;
  origin: string;
  api: GithubApi;
  nowSeconds: number;
}

const field = (body: unknown, key: string): unknown => (body && typeof body === 'object' ? (body as Record<string, unknown>)[key] : undefined);

/** The run's GitHub token: null when the source is a variable that is not set (the run then cannot push). */
export async function githubToken(input: TokenInput): Promise<TokenResult> {
  const {github, env, origin, api, nowSeconds} = input;
  if (github.source === 'env') return {ok: true, token: env[github.variable] || null};
  const slug = repoSlug(origin);
  if (!slug) return {ok: false, error: `a GitHub App token needs a github.com remote, and ${origin || 'no origin'} is not one`};
  const appId = env[github.app_id_variable];
  const key = env[github.app_key_variable];
  if (!appId || !key) return {ok: false, error: `a GitHub App token needs ${github.app_id_variable} and ${github.app_key_variable} in the environment`};
  const jwt = appJwt(appId, key.replace(/\\n/g, '\n'), nowSeconds);
  const found = await api.request('GET', `/repos/${slug.owner}/${slug.name}/installation`, jwt);
  const installation = field(found.body, 'id');
  if (found.status !== 200 || typeof installation !== 'number') return {ok: false, error: `the GitHub App is not installed on ${slug.owner}/${slug.name} (HTTP ${found.status})`};
  const minted = await api.request('POST', `/app/installations/${installation}/access_tokens`, jwt, {repositories: [slug.name]});
  const token = field(minted.body, 'token');
  if (minted.status !== 201 || typeof token !== 'string') return {ok: false, error: `GitHub refused an installation token for ${slug.owner}/${slug.name} (HTTP ${minted.status})`};
  return {ok: true, token};
}
