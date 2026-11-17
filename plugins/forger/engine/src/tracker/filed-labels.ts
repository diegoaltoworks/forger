import type {QueueHome} from '../ports';

/** The labels of a ticket the engine files: the ones the caller names, then the intake label when the queue is in the tracker. */
export function filedLabels(queue: QueueHome, intakeLabel: string, named: string[] = []): string[] {
  return queue === 'tracker' ? [...named, intakeLabel] : [...named];
}
