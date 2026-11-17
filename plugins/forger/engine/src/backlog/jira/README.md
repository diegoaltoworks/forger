# backlog/jira

A Jira Cloud project as the `Backlog`.

## Files

- `query.ts` - the search: the project, the open work, and the intake label or
  the configured `jql`; one call per page. Pure.
- `parse.ts` - an issue to a ticket, and a search answer to its page. The key
  `KEY-123` is the ticket `issue-123`. Pure.
- `reader.ts` - reads each page, then stops. A limit, no answer or a refused
  credential becomes its error. The caller hands in the loop's error classes.

## May import

The core: `config`, `ports`, and `tracker` for the call and the text
conversion. Not `loop`: it imports the backlog.
