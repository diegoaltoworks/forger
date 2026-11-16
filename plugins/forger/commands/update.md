---
description: Carry a set-up repository through an update of forger - upgrade the install, settle conflicts, land it by pull request
disable-model-invocation: true
allowed-tools: Bash(*), Read, Grep, Glob
---

# Update a set-up repository

This brings the repository's install to the plugin this session runs. It does
not update the plugin, nor pull the clone the engine runs from: do that first,
as `docs/reference/install.md` describes, and restart the session. It never
stops an engine, never waives a check, never edits a rule, and never starts the
loop.

Every engine call below runs from the repo root as
`bun "${FORGER_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/bin/work.ts" <command>`; call it `work` here.

## 1. Is it set up

No `.forger/forger.lock.json`: the repository is not set up. Point at
`/forger:setup` and stop.

## 2. Is an engine alive

`work orient --json`. When the action is `attach`, an engine is alive: stop, say
so, and say the update runs after that engine has ended. A halt is reported and
left as it is.

## 3. Is the checkout ready

`work facts --json`. When the checkout is not on the base branch or is not
clean, stop and name which.

## 4. Upgrade on a branch

Make the branch `chore/forger-update` from the base branch and run, there:
```
bun "${FORGER_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/bin/work.ts" setup --upgrade --json
```
The tool classifies each installed file by comparing the lock, the disk and the
pack: untouched files take the new version, refined files are kept, new files are
installed, and nothing is deleted. Relay the report. For each path in `review`:
a `conflict` has the pack's version beside it as `<file>.upstream` - show the
difference and ask the owner whether to merge, keep theirs or take the pack's;
a `removed` or `deleted` file only needs mentioning. Once the owner has decided,
delete the `.upstream` file. Do not decide a conflict yourself.

## 5. Nothing written

When the upgrade wrote nothing: say the install is up to date, return to the base
branch, delete the branch, and go to step 8.

## 6. Check

`work check --json`. Relay each failing check, with `check <name>` as the way to
see its detail; a `checks_error` means the checks could not run, which is not a
pass. A check that fails because of a file the owner's project refined is the
owner's to settle.

## 7. Land it

Commit what `git status --short` lists, push the branch, and open a pull request
whose body has an `## Acceptance` heading with one checkbox item:

```
## Acceptance

- [ ] `bun "${FORGER_PLUGIN_ROOT:-${CLAUDE_PLUGIN_ROOT}}/bin/work.ts" check` exits 0
```
Run `work verify --pr <n>`, then `work merge --pr <n>`. The base branch is never
pushed to. When `verify` does not pass, stop and report its verdict.

## 8. Report

In plain words: what was written, kept and decided, the pull request, the result
of `check`, and that `/forger:work` starts the loop.
