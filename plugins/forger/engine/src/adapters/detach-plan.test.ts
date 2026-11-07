import {describe, expect, test} from 'bun:test';

import {describeStart, engineName, parseEngineStart, planDetach} from './detach-plan';

const base = {sandbox: 'docker', dockerUp: true, origin: 'https://github.com/acme/widgets.git', baseBranch: 'main', image: 'registry.example/engine:1', passthrough: ['ANTHROPIC_API_KEY']};

describe('planDetach', () => {
  test('the docker sandbox starts a named container with a restart policy and no host mount of home', () => {
    const plan = planDetach(base);
    if (plan.kind !== 'container') throw new Error('expected a container');
    expect(plan.name).toBe(engineName(base.origin));
    expect(plan.name).toContain('acme-widgets');
    expect(plan.args[0]).toBe('create');
    expect(plan.args.slice(plan.args.indexOf('--restart'), plan.args.indexOf('--restart') + 2)).toEqual(['--restart', 'unless-stopped']);
    const mounts = plan.args.filter((a, i) => plan.args[i - 1] === '--mount');
    expect(mounts.some(m => m.includes('/var/run/docker.sock'))).toBe(true);
    expect(mounts.some(m => /\/home|~|source=\/(?!var\/run\/docker\.sock)/.test(m))).toBe(false);
  });

  test('a credential goes by name, never its value', () => {
    const plan = planDetach(base);
    if (plan.kind !== 'container') throw new Error('expected a container');
    expect(plan.args).toContain('ANTHROPIC_API_KEY');
    expect(plan.args.join(' ')).not.toContain('ANTHROPIC_API_KEY=');
  });

  test('the host sandbox starts a session, with or without Docker', () => {
    expect(planDetach({...base, sandbox: 'host', dockerUp: false}).kind).toBe('session');
    expect(planDetach({...base, sandbox: 'host'}).kind).toBe('session');
  });

  test('the docker sandbox without a reachable Docker API refuses', () => {
    expect(planDetach({...base, dockerUp: false}).kind).toBe('refused');
  });

  test('the docker sandbox without an engine image refuses and names the field', () => {
    const plan = planDetach({...base, image: null});
    expect(plan.kind).toBe('refused');
    expect(plan.kind === 'refused' && plan.reason).toContain('sandbox_engine_image');
  });

  test('the docker sandbox without an origin refuses', () => {
    expect(planDetach({...base, origin: ''}).kind).toBe('refused');
  });
});

describe('engine start record', () => {
  test('round-trips and describes both modes', () => {
    const c = parseEngineStart('{"mode":"container","name":"n","image":"i"}');
    expect(describeStart(c)).toContain('container n');
    expect(describeStart(parseEngineStart('{"mode":"session","pid":7}'))).toContain('pid 7');
  });
  test('an absent or unreadable record is not started with --detach', () => {
    expect(describeStart(parseEngineStart(null))).toBe('not started with --detach');
    expect(parseEngineStart('nope')).toBeNull();
  });
});
