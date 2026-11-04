# READMEs follow the measurable rules of Simplified Technical English

Status: Accepted

The owner asked for a launch pad that a developer can read in a minute: "Every readme should use simplified technical English, or another international standard for clear technical communication, it should clearly state its purpose at the top and avoid transient information that will go stale."

## Context

ASD-STE100 is the international standard for clear technical writing. It has two parts: writing rules (sentence length, active voice, one topic per paragraph) and a controlled dictionary of approved words. A check must run in the gates, offline, with no dependency and no false alarm that blocks a merge (principle 0).

## Options

1. **Prose guidance only.** Cheap, and it drifts: the README that prompted the request was written under the same guidance.
2. **The full standard, dictionary included.** The dictionary is licensed, large, and bound to word senses a pattern cannot tell apart.
3. **The measurable writing rules, in the `docs` pack's check.** Chosen.

## Decision

`check docs` holds every `README.md` to these rules when the `docs` pack is installed. Each has an opinion id, so a waiver can target one.

- `docs.readme-purpose-first`: the first paragraph after the H1 is at most two sentences.
- `docs.readme-short-sentences`: a step is at most 20 words, a descriptive sentence at most 25, a paragraph at most 6 sentences.
- `docs.readme-active-voice`: a passive construction is a warning. The heuristic has false positives, so it never fails the check.
- `docs.readme-no-transient`: no count of files, tests, lines, modules or entities, no "as of" or dates, no "currently", "recently", "new" or "at the moment", and no version number in prose.

Code blocks, code spans, tables, quotes, headings and images are not prose and are skipped. READMEs under `node_modules` and `fixtures` are not checked. A README that cannot meet a rule carries a waiver.

## Consequences

The check cannot enforce the controlled dictionary, one topic per paragraph, or whether a purpose sentence is a good one. Those stay judgement for the writer and the reviewer. The passive-voice pattern misses some passives and flags some adjectives; the owner may promote it to a failure once the false positives are known. Existing READMEs that fail are waived, so the waiver list is the backlog for rewriting them.
