/** The `gh` command of each read and each write; pure. */

import type {TicketQuery, TrackerWrite} from '../ports';
import {blockCommand} from './github-graphql';
import {quote} from './quote';

export const githubRead = {
  text: (n: number): string => `gh issue view ${n} --json body --jq .body`,
  facts: (n: number): string => `gh issue view ${n} --json labels,body`,
  title: (n: number): string => `gh issue view ${n} --json title --jq .title`,
  labels: (n: number): string => `gh issue view ${n} --json labels --jq ".labels[].name"`,
  state: (n: number): string => `gh issue view ${n} --json state,closedByPullRequestsReferences`,
  lastComment: (n: number): string => `gh issue view ${n} --json comments --jq ".comments[-1].body // empty"`,
  exists: (n: number): string => `gh issue view ${n} --json number`,
  account: (): string => 'gh api user --jq .login',
  repoLabels: (): string => 'gh label list --limit 1000 --json name --jq ".[].name"',
  listing: (label: string): string => `gh issue list --label ${label}`,
  tickets: (q: TicketQuery): string => githubRead.list(q).replace(/ --json number,title$/, ' --json number,title,labels,body'),
  list: (q: TicketQuery): string => {
    const label = q.label === undefined ? '' : ` --label ${quote(q.label)}`;
    const search = q.title === undefined ? '' : ` --search ${quote(`"${q.title}" in:title`)}`;
    const limit = q.limit === undefined ? '' : ` --limit ${q.limit}`;
    return `gh issue list --state ${q.state}${label}${search}${limit} --json number,title`;
  },
};

export function githubCommand(write: TrackerWrite): string {
  switch (write.kind) {
    case 'file':
      return `gh issue create --title ${quote(write.title)} --body ${quote(write.body)}${write.labels.map(l => ` --label ${quote(l)}`).join('')}`;
    case 'comment':
      return `gh issue comment ${write.ticket} --body ${quote(write.body)}`;
    case 'labels': {
      if (write.add.length === 0 && write.remove.length === 0) throw new Error('a label write names a label to add or to remove');
      const add = write.add.map(l => ` --add-label ${quote(l)}`).join('');
      const remove = write.remove.map(l => ` --remove-label ${quote(l)}`).join('');
      return `gh issue edit ${write.ticket}${add}${remove}`;
    }
    case 'body':
      return `gh issue edit ${write.ticket} --body ${quote(write.body)}`;
    case 'pin':
      return `gh issue pin ${write.ticket}`;
    case 'createLabel':
      return `gh label create ${quote(write.name)} --color ${write.color} --description ${quote(write.description)}`;
    case 'block':
      return blockCommand(write.blocked, write.blocker);
  }
}
