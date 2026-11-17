/** Every label, title and text goes into a command through this; a ticket's number is bare. */
export function quote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
