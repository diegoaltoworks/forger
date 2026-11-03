#!/usr/bin/env bun
/**
 * Stable entry point for the work-loop engine. The plugin's commands invoke
 * this path (`${CLAUDE_PLUGIN_ROOT}/bin/work.ts`); the implementation lives in
 * the modular, tested project under ../engine/src.
 */
import {main} from '../engine/src/cli';

main().catch(err => {
  console.error('Error:', err);
  process.exitCode = 1;
});
