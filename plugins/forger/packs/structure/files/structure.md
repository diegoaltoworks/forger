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

## The baseline only shrinks (structure.baseline-ratchet)

A repository that already breaks these rules records the findings once with `check structure --baseline`.
A recorded finding warns; a new one fails.
`check structure --update` removes entries that no longer hold and adds none.
A branch that grows the baseline fails unless the ticket's Decisions name the file.
Vendored and generated code goes under `ignore`, and any rule can be waived for a path in `.forger/waivers.json`.
