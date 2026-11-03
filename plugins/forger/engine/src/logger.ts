/**
 * Terminal + file logging. Colours to the terminal, a plain timestamped line
 * appended to the log file the supervisor tails for terminal signals.
 */

import {writeFileSync} from 'fs';

export type LogLevel = 'INFO' | 'SUCCESS' | 'WARN' | 'ERROR' | 'DEBUG';

export const colors = {
  reset: '\x1b[0m',
  red: '\x1b[0;31m',
  green: '\x1b[0;32m',
  yellow: '\x1b[1;33m',
  blue: '\x1b[0;34m',
  cyan: '\x1b[0;36m',
} as const;

const COLOR_BY_LEVEL: Record<LogLevel, string> = {
  INFO: colors.blue,
  SUCCESS: colors.green,
  WARN: colors.yellow,
  ERROR: colors.red,
  DEBUG: colors.cyan,
};

export class Logger {
  constructor(private logFile: string) {}

  log(level: LogLevel, message: string): void {
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    console.log(`${COLOR_BY_LEVEL[level]}[${timestamp}] [${level}]${colors.reset} ${message}`);
    writeFileSync(this.logFile, `[${timestamp}] [${level}] ${message}\n`, {flag: 'a'});
  }
}
