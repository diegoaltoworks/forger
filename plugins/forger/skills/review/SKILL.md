---
name: review
description: Forger's own review step. Review the diff against the base on standards and spec, fix what is real, decline what is not. Ends in the review_findings contract.
---

# Review

Runs unattended inside forger's loop. Review your own diff as a stranger would; never ask the owner.

## Steps

1. Read the diff with `git diff <base>...HEAD` and the ticket's acceptance criteria.
2. Standards axis: does each change follow the repo's documented rules and the patterns of the code around it? Read the project guide and the folder README of every folder touched.
3. Spec axis: does the diff do what each acceptance criterion asks, no more and no less? Name any criterion with no code or test behind it.
4. Hunt correctness first: wrong conditions, unhandled empty or error cases, state left behind, a decision made in prose that should be a tested command.
5. Rank each finding `low`, `medium`, `high` or `critical`, with the file and line in the diff.
6. Fix every finding at medium or above that is real. Decline one only with a reason that a reader of the ticket would accept. Re-run the gates after fixing.

## Red flags

- A finding that points at a file or line outside the diff.
- "Looks good" with no criterion checked against code.
- A style nit ranked above a correctness bug.
- A fix that widens the change beyond the ticket.
- Declining a finding without a reason.

## Exit criteria

- Every acceptance criterion was checked against the diff.
- Every finding at medium or above is fixed or declined with a reason.
- The gates are green after the fixes.

## Contract

Leave the result in the `review_findings` contract: a list of `{severity, file, line, summary, disposition, reason}`, where a declined finding has a reason. An empty list is valid when the review found nothing. Forger validates it with `contract --slot review`.
