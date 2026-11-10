# Structure decays between tickets

Every ticket the loop builds passes its gates. The tree it builds up still gets worse, one reasonable file at a time. This page says why the per-ticket gates miss it, which patterns to look for, the rules that answer them, and what enforces those rules. `check structure --json` reports the current shape of a repository; nothing here quotes it.

## Why per-ticket gates miss it

A ticket is judged on its own diff. Its tests pass, its types hold, its review finds nothing wrong, and the new file sits beside the last one with a name that follows the neighbours. Structure is not a property of a diff. It is a property of the whole tree, and it only shows when the tree is read as a whole. So each ticket is correct, and the repository drifts anyway. A fix has to look at the tree, not at the change.

## The patterns, each with its fix

1. **Flat folders that mix layers.** Roles are told apart only by a suffix on the file name. Fix: folders are features, and the role is the file's name inside its feature folder.
2. **Prefixes standing in for folders.** One concept is split across several prefixes. Fix: the shared prefix becomes a folder, and one concept lives in one place (`structure.prefix-cluster`).
3. **A flat shared package behind one barrel kept by hand.** Nothing separates the contract, the shared logic and the reference data. Fix: draw those three lines as folders, and let entry points be generated or removed rather than maintained by hand.
4. **One endpoint needing several edits linked by hand, with paths as strings.** A rename then fails at runtime, not at build time. Fix: derive the links from one declaration so a rename is a compile error.
5. **Catch-all files.** Code lives according to when it was written, not what it is for. Fix: move each part to the feature it serves and delete the catch-all.
6. **Names drifting from the glossary, and redirects with no rule for removing them.** Fix: the glossary wins. A redirect carries the condition for its removal, and is deleted when the condition holds.
7. **Leftovers.** Re-export shims, and prototype flags kept after their decision. Fix: import from the source and delete the shim (`structure.shim`); remove a flag when its decision is made.
8. **Layer folders gathering orchestration, and infrastructure loose at the top.** Fix: orchestration moves into the feature that owns it, and infrastructure gets its own folder.
9. **Very large files.** Inline sub-parts, or data beside the functions that use it. Fix: sub-parts become files in a feature folder, and data moves to its own file.
10. **Boundaries that only hold by care.** Fix: state them as rules a check enforces: groups with the groups they may import, server-only code carrying its guard, no cycles (`structure.boundary`, `structure.server-guard`, `structure.cycle`).
11. **Scattered test doubles.** Each test file carries its own fake. Fix: one shared home for doubles, beside the thing they stand in for.
12. **What to keep.** Responses parsed against the shared schema, and failures expressed as one typed union. These are the opposite of drift, so a refactor preserves them.

## The rules

- The glossary wins. When a name and the glossary disagree, the name changes.
- Folders are features and files are roles.
- A file name never repeats its folder (`structure.name-repeats-folder`).
- The server suffix always comes with its guard (`structure.server-guard`).
- Tests are named for their file or for the behaviour they pin.
- A pure function a second consumer needs lives in the shared package, under its domain.

## What enforces it

- **`check structure`** applies the rules from `.forger/structure.json`, and a **ratchet** baseline: a repository starts green on what it already has, the baseline only shrinks, and a branch that grows it needs the owner's decision.
- **The worker's instructions** carry a Structure section, so code is placed by feature from the first line.
- **`## Placement` in a ticket** names where new code goes, and `check ticket` refuses a flagged folder unless the ticket moves the code or names a structure blocker.
- **The periodic structure review** is one whole-repo ticket the loop files after enough merges, or when the baseline holds too many entries.
  The periodic reviews share one schedule in `plugins/forger/engine/src/loop/reviews/`; the safety pack's access review is a second kind.

The order matters when a repository is already in the old shape: enforcement first, so it stops getting worse; then expand, by adding the new location beside the old; then migrate callers a slice at a time; then contract, by deleting the old location. Skipping straight to a rename breaks every open branch at once.

See [Opinion packs](08-opinion-packs.md) for the pack and [Tickets](03-tickets.md) for the Placement section.
