# Structure opinions

What the structure pack holds, and why. Every rule is enforced by `check structure`.
A tree decays one reasonable file at a time: each ticket adds the next file beside the last one and names it with a prefix.
No single diff is wrong, so the shape of the tree gets its own check.

## Folders stay small (structure.folder-size)

A folder holds at most `folder_limit` source files at its top level.
Test files do not count.
Past the limit, group the files by feature into folders.

## A shared prefix is a folder (structure.prefix-cluster)

`prefix_cluster` or more files in one folder whose names start with the same word want to be a folder.
The first word ends at `-`, `_`, `.` or a lower-to-upper case change, so `stopForm.ts` and `stop-list.ts` both start with "stop".
Make "stop" a folder and move them in.

## A name does not repeat its folder (structure.name-repeats-folder)

`stops/stopForm.ts` and `trip/trip-header.tsx` say the folder's name twice.
The folder already says it: use `stops/form.ts`.

## Frozen folders do not grow (structure.frozen-folder)

List a folder glob under `frozen` when it is a dumping ground you are moving out of.
A new top-level file there fails.

## No shims (structure.shim)

A file whose every statement re-exports from another file only hides where the code lives.
Import from the source file and delete the shim.
Entry files, `index.*` by default, are exempt.

## Server code carries its guard (structure.server-guard)

`server_guards` is a list of `{files, must_import}` pairs, such as `{"files": "**/*.server.*", "must_import": "server-only"}`.
A matching file that does not import `must_import` is a finding at line 1: the suffix promises what the file does not deliver.

## Browser files do not import server files (structure.client-imports-server)

A file whose first statement is one of `client_markers` (`"use client"` and `'use client'` by default) must not import a file that matches a `server_guards` glob.
The finding sits at the import's line.

## Boundaries hold (structure.boundary)

`boundaries` names path groups.
Each has `paths` (globs), `may_import` (the names of the groups it may import; its own group is always allowed) and an optional `external`, the bare packages it may import.
No `external` means any package.
Node built-ins, written `node:fs` or `fs`, are packages like any other and must be listed when `external` is set.
An import into a group it may not import, or a package outside the list, is a finding at the import's line.

## No import cycles (structure.cycle)

With `cycles` set to true, each cycle among the project's own files is one finding at the first file of the cycle, listing the cycle.
Type-only imports are erased at runtime and do not count.

## A periodic review (review)

`review.every_merged` merged tickets since the last review, or more than `review.warnings_over` baseline entries, make the loop file one whole-repo structure review.
The review is a spike: a document at `docs/review-code-structure.md`, an ADR, and drafted tickets for the owner to file.
Set either number to 0 to turn that trigger off.
No second review is filed while one labelled `structure-review` is open.

## The baseline only shrinks (structure.baseline-ratchet)

A repository that already breaks these rules records the findings once with `check structure --baseline`.
A recorded finding warns; a new one fails.
`check structure --update` removes entries that no longer hold and adds none.
A branch that grows the baseline fails unless the ticket's Decisions name the file.
Vendored and generated code goes under `ignore`, and any rule can be waived for a path in `.forger/waivers.json`.

## Where a worker puts a file

The rules above are what the check enforces; these are what a worker does before it runs.

- Find the feature folder a new file belongs in. If there is none, create one following `## Structure` in `process.md`.
- Never add a sibling to a folder that is over its limit or frozen.
- Never name a file with its folder's name as a prefix.
- When a ticket touches a catch-all file, move the touched part to its feature's home instead of growing the file.
- When logic moves, update its imports and leave no re-export shim.
- Run `check structure` before committing. A new finding is fixed by moving the file; only the owner waives.
