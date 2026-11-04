# intent

Whether a planning request is `product` or `creative`. `/forger:plan` runs a
creative-brief round only for a creative request.

## Files

- `classify.ts` - `classifyIntent` finds the signals in the request text and
  in the repo's dependencies. It returns the intent they add up to. Pure.
- `fixtures/` - a sample creative brief that the tests and the plan command's
  docs use as an example.

## Entry point

`index.ts`. The `intent` command in `cli/` reads the manifest and prints the
result.

## May import

Nothing outside this folder.
