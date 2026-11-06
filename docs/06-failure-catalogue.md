# Failure catalogue

Failures seen in real runs of the loop. Each is one row: **Open** while an issue
is still fixing it, **Fixed** once every issue in its row is closed by a merged
PR. The issue holds the detail of the cause and the fix, and git history holds
what this file used to say about each failure.

`work catalogue --update` asks the tracker and moves each row to the table it
belongs in, naming the merged PRs. `check docs` fails on an Open row with no
open issue, on a row that disagrees with the tracker, and on an entry section
(a `###` heading).

To add a failure, open an issue for it, then add a row to the Open table linking
that issue. A failure seen again gets its new open issue added to its Fixed row;
the next `work catalogue --update` moves the row back to Open.

## Open

| Failure | What it looks like | Issue |
|---|---|---|
| A ticket marked completed before it merged | A ticket reads completed before its PR merges, and the next one starts on a base without it. | [#293](https://github.com/diegoaltoworks/forger/issues/293) |
| A timed-out run leaves an empty log | A run far past its timeout goes unnoticed because its log holds nothing. | [#294](https://github.com/diegoaltoworks/forger/issues/294) |
| The worker gets no warning before the deadline | A worker is killed at its deadline with no chance to push or hand over. | [#295](https://github.com/diegoaltoworks/forger/issues/295) |
| The engine dies with the session | An engine started from a supervising session ends when the session restarts. | [#296](https://github.com/diegoaltoworks/forger/issues/296) |

## Fixed

| Failure | What it looked like | Fixed by |
|---|---|---|
| A worker hangs and the timeout never fires | A worker waits on a pattern that matches itself and runs for hours past its timeout. | before tickets were tracked |
| A run that merged counts as a failure | A worker merges, then times out writing its summary, and the run counts as a failure. | before tickets were tracked |
| An early stop signal halts a run that merged | A stop tag printed mid-run halts a run that went on to merge. | before tickets were tracked |
| A red merge counted as completed | A PR merged before CI finished, the base went red, and the run still counted as completed. | before tickets were tracked |
| A worker merges its own PR by hand | A worker merges with the CLI instead of the merge tool. | before tickets were tracked |
| Adopting new work looks like a stall | A run adopts a new issue, the remaining count does not drop, and the engine counts a stall. | before tickets were tracked |
| The log names a ticket the worker is not building | The log names the engine's pick while the worker builds another ticket. | before tickets were tracked |
| A worker overrides the engine's pick | The worker builds a ticket other than the one the engine named. | before tickets were tracked |
| A worker certifies its own acceptance | The worker ticks its own acceptance boxes and nothing independent checks them. | before tickets were tracked |
| A worker failure and a platform failure look the same | An expired login fails runs in seconds and the halt blames the worker. | before tickets were tracked |
| A parallel start loses the prompt | Two workers start together and one gets no prompt, so the loop halts on failures. | before tickets were tracked |
| The tracker's rate limit reads as a dead tracker | A spent GraphQL budget reads as not authenticated or offline. | before tickets were tracked |
| Clearing a HALT does not stick | The owner clears the HALT file and the engine writes it again. | before tickets were tracked |
| Every engine start logs a false stall | A fresh start logs a stall before doing any work. | before tickets were tracked |
| Local-only files count as a dirty tree | A local settings file or the work order modified counts the run as a failure. | before tickets were tracked |
| An engine restarted mid-iteration re-runs the ticket | A restart re-runs the open ticket on top of the branch the first run pushed. | before tickets were tracked |
| The engine exits "all tasks completed" while work remains | The engine reports everything done while the owner's work order still lists work. | before tickets were tracked |
| Two workers start together and one gets no prompt | The first run with two workers halts within a minute on an empty prompt. | [#205](https://github.com/diegoaltoworks/forger/issues/205) - merged in [#211](https://github.com/diegoaltoworks/forger/pull/211) |
| A verified merge halts as unverified | A PR with a passing verdict for its head merges and the loop halts it as unverified. | [#241](https://github.com/diegoaltoworks/forger/issues/241) - merged in [#242](https://github.com/diegoaltoworks/forger/pull/242) |
| A PR without a ticket branch can never be verified | A PR on a branch not named for a ticket is refused by verify, so it cannot merge. | [#220](https://github.com/diegoaltoworks/forger/issues/220) - merged in [#244](https://github.com/diegoaltoworks/forger/pull/244) |
| The verifier cannot run the code it judges | The verifier answers cannot_tell because its checkout is read-only and the install fails. | [#190](https://github.com/diegoaltoworks/forger/issues/190) - merged in [#226](https://github.com/diegoaltoworks/forger/pull/226) |
| The verifier answers "can't tell" with no reason | A criterion comes back cannot_tell with no evidence and no reason. | [#193](https://github.com/diegoaltoworks/forger/issues/193) - merged in [#227](https://github.com/diegoaltoworks/forger/pull/227) |
| Test evidence never checks out, so a passing PR is unclear | The verifier cites a test by its full name, the lookup finds nothing, and every met becomes cannot_tell. | [#229](https://github.com/diegoaltoworks/forger/issues/229) - merged in [#237](https://github.com/diegoaltoworks/forger/pull/237) |
| The verifier passes a screen that is visibly wrong | Gates, checks and the verifier pass a screen a person sees is wrong. | [#189](https://github.com/diegoaltoworks/forger/issues/189), [#194](https://github.com/diegoaltoworks/forger/issues/194), [#195](https://github.com/diegoaltoworks/forger/issues/195) - merged in [#225](https://github.com/diegoaltoworks/forger/pull/225), [#257](https://github.com/diegoaltoworks/forger/pull/257), [#258](https://github.com/diegoaltoworks/forger/pull/258) |
| A UI state the screenshot tool cannot reach | A ticket asks for a screenshot of a state the tool cannot capture, and the fix is refused. | [#191](https://github.com/diegoaltoworks/forger/issues/191) - merged in [#256](https://github.com/diegoaltoworks/forger/pull/256) |
| A vague or unsourced criterion decides the outcome | A criterion is read one way by the worker and another by the verifier, or sets a threshold with no source. | [#196](https://github.com/diegoaltoworks/forger/issues/196) - merged in [#228](https://github.com/diegoaltoworks/forger/pull/228) |
| The verifier's checkout fills the system temp folder | The verifier's checkout exhausts a quota-limited temp folder and no verdict is written. | [#268](https://github.com/diegoaltoworks/forger/issues/268) - merged in [#269](https://github.com/diegoaltoworks/forger/pull/269) |
| Faithful but flat | A demo is correct, tested and accessible, and misses the feel the owner asked for. | [#230](https://github.com/diegoaltoworks/forger/issues/230), [#235](https://github.com/diegoaltoworks/forger/issues/235) - merged in [#245](https://github.com/diegoaltoworks/forger/pull/245), [#261](https://github.com/diegoaltoworks/forger/pull/261) |
| A watcher on the wrong process | A watcher follows the launcher's process id and reports the engine gone while it works. | before tickets were tracked |
| A watcher that matches its own command | A watcher matches its own command line or an old log line and reports a halt that is not there. | before tickets were tracked |
| A watcher's pipe holds back the event that matters | A buffered pipe delays a halt notice until the supervisor looks. | [#199](https://github.com/diegoaltoworks/forger/issues/199) - merged in [#259](https://github.com/diegoaltoworks/forger/pull/259) |
| A supervisor kills its own shell | A pkill pattern matches the supervisor's own command line. | before tickets were tracked |
| Background work reports done before its files exist | A completion notice arrives before the files, log or checks it announces. | before tickets were tracked |
| The engine finds no work while issues wait | Issues labelled for the loop are not queued and the engine exits at once. | before tickets were tracked |
| A rule held only in a memory note is broken again | A rule kept only in a memory note is broken by workers that had it loaded. | before tickets were tracked |
| A hook rejects late and the rejection is missed | A hook rejects only after minutes of gates, and the one-line rejection is missed. | before tickets were tracked |
| Knock-on test failures found one CI run at a time | A change breaks tests elsewhere and each CI run reveals one more. | before tickets were tracked |
| CI's default `runs-on` image moved | CI lands on a newer default image where the browser tool cannot install. | before tickets were tracked |
| The loop acts with credentials that are not its own | The loop's actions are attributed to an account that is not its scoped token, or hold more access than it needs. | before tickets were tracked |
| Two test runs share one database | Parallel test runs lock one shared test database. | before tickets were tracked |
| Setup misreads a new repository | Setup takes the wrong project root, writes a home path or misses the test command. | [#183](https://github.com/diegoaltoworks/forger/issues/183), [#184](https://github.com/diegoaltoworks/forger/issues/184), [#185](https://github.com/diegoaltoworks/forger/issues/185), [#186](https://github.com/diegoaltoworks/forger/issues/186), [#197](https://github.com/diegoaltoworks/forger/issues/197) - merged in [#223](https://github.com/diegoaltoworks/forger/pull/223), [#224](https://github.com/diegoaltoworks/forger/pull/224), [#253](https://github.com/diegoaltoworks/forger/pull/253), [#254](https://github.com/diegoaltoworks/forger/pull/254), [#255](https://github.com/diegoaltoworks/forger/pull/255) |
| Branch protection lost when a repository moves | A transfer drops branch protection and the required check with it. | [#187](https://github.com/diegoaltoworks/forger/issues/187) - merged in [#201](https://github.com/diegoaltoworks/forger/pull/201) |
| A guard that matches text refuses harmless commands | A hook that refuses hand merges matches quoted text in a comment. | [#192](https://github.com/diegoaltoworks/forger/issues/192) - merged in [#202](https://github.com/diegoaltoworks/forger/pull/202) |
| An old stash popped by a shell error | A shell glob error pops an unrelated old stash into the working tree. | before tickets were tracked |
| A stopped engine keeps the state-branch lease | A restarted engine is refused while the lease still names the stopped one. | before tickets were tracked |
| The engine runs from a checkout behind origin | Restarts run an old engine from a checkout behind origin. | [#238](https://github.com/diegoaltoworks/forger/issues/238) - merged in [#250](https://github.com/diegoaltoworks/forger/pull/250) |
| A refused state-branch write does not name the identity | A resume under an identity that cannot push the state branch leaves the HALT in place, and the refusal does not say which identity it used. | [#238](https://github.com/diegoaltoworks/forger/issues/238) - merged in [#250](https://github.com/diegoaltoworks/forger/pull/250) |
| An outside pull request is invisible to the loop | The loop builds a ticket a contributor's open PR already fixes. | [#264](https://github.com/diegoaltoworks/forger/issues/264) - merged in [#267](https://github.com/diegoaltoworks/forger/pull/267) |
| A new gate halts every older install | A new gate is red on every repository set up before it existed, and each loop halts. | [#283](https://github.com/diegoaltoworks/forger/issues/283) - merged in [#287](https://github.com/diegoaltoworks/forger/pull/287) |
| A branch behind main lowers coverage after it merges | A PR passes on a stale base and the merged result fails the coverage ratchet. | [#262](https://github.com/diegoaltoworks/forger/issues/262) - merged in [#263](https://github.com/diegoaltoworks/forger/pull/263) |
