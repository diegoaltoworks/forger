# The engine picks the ticket; the worker builds it or declines on the record

Status: Proposed

The engine chooses the next ticket with a tested command (`backlog --json`, `next`). A worker is then free to build a different one, and nothing stops it: the engine logs "Worker took X (engine picked Y)" and counts the run a success. That makes ticket choice a decision the model can overturn, which principle 0 forbids (ADR 0002).

## What happened

On four consecutive iterations the engine's pick was the same open ticket, and the worker built a different one each time. Evidence:

- `.claude/output/iteration-21.log`, `-22.log`, `-23.log` each carry `engine pick:` for the skipped ticket and a `ticket:` line for another one. The log header omits the pick line when the two agree (iteration 20), so a mismatch is only visible there.
- `plugins/forger/engine/src/loop/iteration.ts` (the "Worker took ... (engine picked ...)" branch) logs the mismatch at INFO and then sets `ticket` to the branch's ticket. The outcome decider sees a normal built-and-merged run.
- The skipped ticket was fully workable: it was open, labelled for the loop, its only blocker was closed, and it shared a priority with the three tickets that were built. Priority ties break by issue number (`plugins/forger/engine/src/backlog/github-backlog.ts`), so it was the first of its tier. It was built later without incident.
- The worker's final messages never mention the skipped ticket. They do not say it was considered or why it was passed over. The logs keep only the last message, so the reasoning is not recoverable.

## Cause

The engine's pick never reaches the worker as a fact. `plugins/forger/engine/src/loop/prompt.ts` tells the worker to "Select and implement ONE ticket (deps completed, and not another repo's)", which is an invitation to choose. The only route to the pick is a sentence in the command asking the worker to run `backlog --json` and take `next`, and a prompt that says "select" outweighs it. The engine then rewards the deviation: `ticket` becomes the branch's ticket, so the run succeeds and the pick is never held to account. There is also no way to say "I will not build this one", so a worker with a real reason (a blocker the tracker does not show, a ticket too large for one context, an unclear spec) can only quietly build something else.

I could not tell from the logs which of those reasons, if any, applied in these four runs. The design therefore must not depend on the answer: it handles all three.

## Options

- **(a) The engine hands over one ticket; any other branch is a failure.** The prompt names the ticket. A run whose branch ticket differs from the pick is an `off-pick` outcome, never a success. Simple and fully deterministic. A worker with a real reason to refuse has no honest move, and a bad ticket stalls the loop until someone notices.
- **(b) The worker may decline with a recorded reason; the engine acts on it.** Without (a) a worker can still build something else and call it a decline.
- **(c) Both.** The pick is the contract; a decline is the only sanctioned exit from it, and it is a structured record the engine reads.

## Recommendation: (c)

The engine decides what is built. The worker decides only whether the pick can be built, and says so in a form a command checks. Defaults chosen, for the owner to overturn:

1. **The prompt names the pick** and says the worker builds that ticket or declines it. The word "select" goes. The command's selection step becomes "read the ticket named in the prompt".
2. **A decline is a command**, `decline --ticket <id> --reason <blocked|too-large|unclear> --detail <text> --json`. It writes a decline record (ticket, reason, detail) to a file under `.claude/` and, on GitHub, swaps `ready-for-agent` for `needs-info` and comments the detail on the issue. The worker then ends with the `stop` signal. The tool does the relabel, so the worker does not hand-edit labels.
3. **The outcome is decided from facts**, in the pure decider that already exists for outcomes, by this table:

| Branch ticket | Decline record | Outcome |
|---|---|---|
| the pick, merged | none | built (success, as today) |
| the pick, not merged | none | failed, as today |
| none | for the pick | declined |
| another ticket | none | off-pick (failure) |
| another ticket | for the pick | off-pick (failure); the decline is still honoured |
| none | for another ticket | failed (the record is not for this run's pick) |

An off-pick branch is never counted as the pick's completion and never as a success, even if its own PR merged: the work is real, but the loop did not do what it was told. Because the ticket label swap makes a declined ticket leave `next`, the same ticket is not picked again.
4. **Declines are bounded.** A decline resets nothing: a declined run counts toward the stall counter, and a run of declines in a row (default three) halts the loop with a report line naming each ticket and reason, so the owner sees a backlog the loop cannot work instead of a loop that quietly drains it.
5. **The owner sees it.** The loop's report lists declined tickets with their reason. `needs-info` is the existing label for "waiting on an answer", so the owner's answer is to edit the issue and relabel it `ready-for-agent`.

## Measures and the failure catalogue

Yes to both. The pick-versus-built mismatch is a process measure: the share of runs that were off-pick, and the share that were declined, each reported by the measures command from the iteration facts, not typed into a doc. The failure catalogue gains an entry for a worker overriding the engine's pick, with the fix recorded as the tool and the check, not a prompt warning.

## Consequences

- Every decision here is a pure function over facts (the outcome table) or a tested command (`decline`, the prompt builder); the prompt keeps only the judgement of whether a ticket can be built.
- A model that wants a different ticket now has to say why, on the record, and the owner can read it.
- Cost: a worker with a good reason to prefer another ticket must decline first, which spends one iteration. That is the intended price of the engine owning the order.
- Build work is filed as separate tickets awaiting triage: the outcome table, the prompt and command, the decline command, then the measures and catalogue entry.
