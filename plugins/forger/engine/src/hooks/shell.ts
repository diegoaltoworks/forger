/**
 * Enough of a shell's grammar to see which programs a command line runs: the
 * words of each simple command, split on the operators that chain them, with
 * quotes resolved and redirect targets kept apart. It is a reader for a guard,
 * not an interpreter: nothing is expanded, and `bash -c`, `eval`, `$(...)` and
 * backticks are read as commands of their own, so a refused call cannot hide
 * inside one. Pure.
 */

export interface Segment {
  words: string[];
  /** The files written by `>`, `>>` and their fd-numbered forms. */
  redirects: string[];
}

const OPERATORS = ['&&', '||', ';;', '$(', ';', '|', '&', '\n', '(', ')', '`'];

interface Token {
  kind: 'word' | 'op' | 'redirect';
  text: string;
}

/** The command with each heredoc body removed: the body is data fed to a program, not commands. */
export function withoutHeredocs(command: string): string {
  let out = command;
  let from = 0;
  for (;;) {
    const re = /<<(?!<)-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g;
    re.lastIndex = from;
    const m = re.exec(out);
    if (!m) return out;
    const lineEnd = out.indexOf('\n', m.index + m[0].length);
    from = m.index + m[0].length;
    if (lineEnd === -1) continue;
    const lines = out.slice(lineEnd + 1).split('\n');
    const stop = lines.findIndex(l => l.replace(/^\t+/, '') === m[2]);
    const consumed = stop === -1 ? lines.length : stop + 1;
    const rest = lines.slice(consumed).join('\n');
    out = out.slice(0, lineEnd) + (consumed < lines.length ? '\n' + rest : '');
  }
}

function tokenize(rawCommand: string): Token[] {
  const command = withoutHeredocs(rawCommand);
  const tokens: Token[] = [];
  let word = '';
  let inWord = false;
  const flush = (): void => {
    if (inWord) tokens.push({kind: 'word', text: word});
    word = '';
    inWord = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === '\\' && i + 1 < command.length) {
      if (command[i + 1] !== '\n') {
        word += command[i + 1];
        inWord = true;
      }
      i++;
      continue;
    }
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      const stop = end === -1 ? command.length : end;
      word += command.slice(i + 1, stop);
      inWord = true;
      i = stop;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < command.length && command[j] !== '"') {
        if (command[j] === '\\' && j + 1 < command.length) j++;
        word += command[j];
        j++;
      }
      inWord = true;
      i = j;
      continue;
    }
    if (c === ' ' || c === '\t') {
      flush();
      continue;
    }
    if (c === '#' && !inWord) {
      const nl = command.indexOf('\n', i);
      i = nl === -1 ? command.length : nl - 1;
      continue;
    }
    if (c === '>' || (c === '&' && command[i + 1] === '>')) {
      if (inWord && /^\d+$/.test(word)) {
        word = '';
        inWord = false;
      }
      flush();
      i += c === '&' ? 2 : 1;
      if (command[i] === '>') i++;
      if (command[i] === '|') i++;
      if (command[i] === '&') {
        while (i + 1 < command.length && /[\d-]/.test(command[i + 1])) i++;
        continue;
      }
      tokens.push({kind: 'redirect', text: '>'});
      i--;
      continue;
    }
    const op = OPERATORS.find(o => command.startsWith(o, i));
    if (op) {
      flush();
      tokens.push({kind: 'op', text: op});
      i += op.length - 1;
      continue;
    }
    if (c === '<') {
      flush();
      continue;
    }
    word += c;
    inWord = true;
  }
  flush();
  return tokens;
}

/** The simple commands of a command line, in order. */
export function segments(command: string): Segment[] {
  const out: Segment[] = [];
  let current: Segment = {words: [], redirects: []};
  let pendingRedirect = false;
  const end = (): void => {
    if (current.words.length > 0 || current.redirects.length > 0) out.push(current);
    current = {words: [], redirects: []};
  };
  for (const t of tokenize(command)) {
    if (t.kind === 'op') {
      pendingRedirect = false;
      end();
    } else if (t.kind === 'redirect') {
      pendingRedirect = true;
    } else if (pendingRedirect) {
      current.redirects.push(t.text);
      pendingRedirect = false;
    } else {
      current.words.push(t.text);
    }
  }
  end();
  return out.flatMap(unwrap);
}

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);

/** Programs that run the rest of their words as a command. */
const WRAPPERS: Record<string, {valued: string[]}> = {
  env: {valued: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string']},
  sudo: {valued: ['-u', '-g', '-C', '-D', '-h', '-p', '-U']},
  command: {valued: []},
  builtin: {valued: []},
  exec: {valued: ['-a']},
  nohup: {valued: []},
  time: {valued: ['-f', '-o']},
  nice: {valued: ['-n']},
  stdbuf: {valued: ['-i', '-o', '-e']},
  xargs: {valued: ['-I', '-L', '-n', '-P', '-d', '-E', '-s', '-a']},
  timeout: {valued: ['-s', '--signal', '-k', '--kill-after']},
};

export function programName(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1);
}

/** Strips assignments and wrappers off a simple command, and reads a nested shell's command string as commands of its own. */
function unwrap(segment: Segment): Segment[] {
  const words = [...segment.words];
  for (;;) {
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
    if (words.length === 0) return segment.redirects.length > 0 ? [{words: [], redirects: segment.redirects}] : [];
    const program = programName(words[0]);
    if (SHELLS.has(program)) {
      const c = words.findIndex((w, i) => i > 0 && /^-[a-z]*c[a-z]*$/.test(w));
      if (c !== -1 && words[c + 1] !== undefined) return [...segments(words[c + 1]), ...(segment.redirects.length ? [{words: [], redirects: segment.redirects}] : [])];
      break;
    }
    if (program === 'eval') return segments(words.slice(1).join(' '));
    const wrapper = WRAPPERS[program];
    if (!wrapper) break;
    words.shift();
    if (program === 'timeout') {
      while (words.length > 0 && words[0].startsWith('-')) words.splice(0, wrapper.valued.includes(words[0]) ? 2 : 1);
      words.shift();
      continue;
    }
    while (words.length > 0 && (words[0].startsWith('-') || (program === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])))) {
      if (words[0] === '--') {
        words.shift();
        break;
      }
      words.splice(0, wrapper.valued.includes(words[0]) ? 2 : 1);
    }
  }
  return [{words, redirects: segment.redirects}];
}
