import type {OpenTicket} from '../backlog';
import type {CapturingRunner} from '../ports';

const QUERY = 'query($owner:String!,$repo:String!,$label:String!){repository(owner:$owner,name:$repo){issues(first:100,states:OPEN,labels:[$label]){nodes{number body blockedBy(first:50){nodes{number}}}}}}';

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** The gh call for the open tickets; gh fills {owner} and {repo} only in field values, never inside the query text. */
export function openTicketsCommand(label: string): string {
  return `gh api graphql -F owner='{owner}' -F repo='{repo}' -f label=${shellQuote(label)} -f query=${shellQuote(QUERY)}`;
}

/** The open tickets carrying the intake label, with their native blockers; throws with gh's own error when the call fails. */
export function readOpenTickets(run: CapturingRunner, label: string): OpenTicket[] {
  const r = run(openTicketsCommand(label));
  if (r.exitCode !== 0) throw new Error(r.stderr.split('\n').map(l => l.trim()).filter(l => l !== '').join(' ') || `gh exited ${r.exitCode}`);
  const nodes = (JSON.parse(r.stdout) as {data: {repository: {issues: {nodes: Array<{number: number; body: string; blockedBy?: {nodes: Array<{number: number}>}}>}}}}).data.repository.issues.nodes;
  return nodes.map(n => ({number: n.number, body: n.body ?? '', native: (n.blockedBy?.nodes ?? []).map(b => b.number)}));
}
