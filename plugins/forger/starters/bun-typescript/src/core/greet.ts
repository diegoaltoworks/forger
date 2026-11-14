/** Pure: the greeting for a name; a blank name greets the world. */
export function greet(name: string): string {
  const who = name.trim();
  return `Hello, ${who === '' ? 'world' : who}!`;
}
