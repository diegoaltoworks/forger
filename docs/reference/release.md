# Releases

What a version means, how the next one is decided, the forms of `release` and how a merged release is tagged.

## What a version means

The plugin's manifest and the engine's package hold one version, `x.y.z`. An
update of an installed copy moves it from one version to the next, and the
changelog says what the move brought. A release is a ticket the loop builds like
any other: the base branch takes a change only through a verified pull request,
so `release` never writes to it, makes no commit, no tag and no push. The tag comes after the merge, from a workflow.

## How the bump is decided

The changes are the tickets merged since the tag `v<current version>`; with no
such tag, every ticket merged since the version was last changed in the first
release file. The bump comes from the labels of those tickets:

- `patch` when none is an enhancement;
- `minor` when one carries `enhancement`;
- `major` when one carries `breaking`, or `minor` while the version is below 1.0.0.

With no change there is nothing to release. `--bump` replaces the computed bump.
The files must agree on the current version; when they do not, the command names them.

## Configuration

`release.files` lists JSON files with the key that holds the version in each;
`release.changelog` is the changelog's path (default `CHANGELOG.md`). With no
`release.files` the command says releases are not configured and exits 1. See
[configuration](configuration.md).

## The forms

| Form | What it does |
|---|---|
| `release --plan [--json] [--bump B]` | Prints the current version, the bump, the next version and the changes, one line each with its ticket and pull request |
| `release --file` | Files the release ticket with the intake label, and none while one is open. Filing it is the owner's word |
| `release --write --version V` | Writes V into every release file and puts an entry for it on top of the changelog, grouped as added and fixed. The release ticket's worker runs it |
| `release --check --version V` | Exits 0 when every file holds V and the changelog's first entry is for V, else 1 with what differs |
| `release --notes --version V` | Prints the changelog's entry for V without its heading; exits 1 when there is none. The workflow uses it as the text of the published release |

## Tagging

`.github/workflows/release.yml` runs on a push to the base branch that changes a
release file. It reads the version; when the tag `v<version>` does not exist it
makes that tag on the pushed commit and publishes a release of that name whose text is
`release --notes`. When the tag exists it does nothing. It holds write permission on
the contents and nothing else, makes no commit and pushes to no branch. The tag marks
the commit that holds the version, so `release --plan` counts the next changes from it,
and an installed copy can be pinned to a tag.
