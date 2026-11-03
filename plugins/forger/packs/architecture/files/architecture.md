# Architecture opinions

What the architecture pack holds, and why. A rule marked "check" is enforced by
`check arch`; the rest are judgement, kept by whoever writes the code.

## Functional core, imperative shell

Decisions are pure functions of their inputs. Reading files, running commands
and calling services sit at the edges and hand the core plain values. A pure
decision is tested with a table; an impure one needs a world built around it.

## Ports and adapters

Every external system sits behind an interface the core owns. There is one real
adapter and one fake for tests, so a test never reaches the network or the disk
by accident and swapping a system touches one file.

## The dependency rule

The core never imports the shell. The layer map in `.claude/architecture.json`
names layers as path globs and lists which layer may import which; a layer may
always import itself. `check arch` builds the import graph and reports each
import that crosses a forbidden edge, whether it is static, type-only, dynamic,
a re-export or a `require`. Packages and files outside every layer are not
constrained. TypeScript and JavaScript are read today; other languages plug in
as another import extractor.

The starter map ships with `src/core` and `src/shell`. Rewrite the globs to
match your tree, and mark as core only the modules that really are pure.

## Parse, don't validate

Outside input (files, flags, API responses) is parsed once at the boundary into
a type the rest of the code can trust. Past the boundary nothing re-checks the
shape.

## Fail loud, never fail empty

An unreadable source is an error with a reason. Returning an empty list for a
file that could not be read turns a broken setup into a quiet pass.

## Idempotent commands, machine-readable output

Running a command twice leaves the same state, and it can print JSON so another
command or a person's script reads it without scraping prose.

## One source of truth per fact

A derived value is computed where it is used, not stored beside the thing it
derives from, where it will drift.

## Config over code

Variation between projects is data in a config file, checked against a schema,
not a fork of the code.

## Expand, migrate, contract

A shape that other code depends on changes in three steps: add the new shape
beside the old, move the users over, remove the old. No step breaks a user.

## Deep interfaces

A unit of code offers a small interface over a lot of behaviour. Many shallow
units that each do little push the complexity onto their callers.

## Decisions are recorded

A new dependency or a change to the layer map is a decision. It leaves an ADR
under `docs/adr/` in the same diff (`.claude/templates/adr.md` is the shape:
context, decision, consequences, status). An ADR is superseded by a new one,
never edited. `check decisions` enforces this by reading the diff against the
base branch; a version bump or a removed dependency needs no ADR.
