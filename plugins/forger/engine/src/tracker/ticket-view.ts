/** What `work ticket` prints: a ticket's title, labels and text. Pure. */

export interface TicketView {
  ticket: number;
  title: string;
  labels: string[];
  body: string;
}

export function ticketMarkdown(view: TicketView): string {
  const labels = view.labels.length > 0 ? `Labels: ${view.labels.join(', ')}` : 'Labels: none';
  return [`# ${view.title}`, '', labels, '', view.body.trim() === '' ? '(no text)' : view.body.trimEnd(), ''].join('\n');
}
