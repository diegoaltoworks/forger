# Spec opinions

What the spec pack holds, and why. A rule marked "check" is enforced by
`check spec`; the rest are judgement, kept by whoever writes the code.

The spec holds the current state of what the product must do; the issue is the
unit of change. They refer to each other in one direction: an issue names
requirement IDs, and the spec never names an issue.

## Tickets name requirements (check: spec.ticket-names-requirements)

A ticket that changes behaviour carries a `Satisfies:` line in its body, naming
the requirement IDs it changes, separated by commas or spaces. Intake writes or
updates the requirements first, then files the issue naming them. An issue with
no such line is flagged.

## Named requirements are satisfied (check: spec.named-requirements-satisfied)

`check spec` reads the requirement report and looks up each named ID. Severity
follows the requirement's modality: an unsatisfied MUST fails, an unsatisfied
SHOULD warns, an unsatisfied MAY informs. A named ID that is unknown (no
validator reports it, or it is not in the spec) is a coverage gap at the same
severity, never a pass. With no report provider the check says so as a gap.

## A MUST never regresses (check: spec.must-never-regresses)

Any MUST satisfied on the base branch must still be satisfied on the branch,
whether or not the ticket names it.

## A validator is not the requirement (rule: spec.validator-not-requirement)

A failing validator means the code is wrong or the validator is. It is never an
invitation to loosen the requirement; that changes only through intake.
