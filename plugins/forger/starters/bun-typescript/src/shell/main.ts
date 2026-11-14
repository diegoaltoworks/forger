import {greet} from '../core/greet';

/** The line the program prints for its arguments. */
export function run(args: string[]): string {
  return greet(args.join(' '));
}

if (import.meta.main) console.log(run(process.argv.slice(2)));
