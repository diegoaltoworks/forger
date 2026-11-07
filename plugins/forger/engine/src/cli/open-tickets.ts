import type {OpenTicket} from '../backlog';

/** The open tickets carrying the intake label, with their native blockers. */
export function readOpenTickets(run: (cmd: string) => string, label: string): OpenTicket[] {
  const query = `query{repository(owner:"{owner}",name:"{repo}"){issues(first:100,states:OPEN,labels:[${JSON.stringify(label)}]){nodes{number body blockedBy(first:50){nodes{number}}}}}}`;
  const raw = run(`gh api graphql -f query='${query}'`);
  const nodes = (JSON.parse(raw) as {data: {repository: {issues: {nodes: Array<{number: number; body: string; blockedBy?: {nodes: Array<{number: number}>}}>}}}}).data.repository.issues.nodes;
  return nodes.map(n => ({number: n.number, body: n.body ?? '', native: (n.blockedBy?.nodes ?? []).map(b => b.number)}));
}
