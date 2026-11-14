/**
 * What a project must look like after `setup`, one assertion per setup bug the
 * demo repositories hit. Pure over observations, so each assertion is tested
 * against a broken observation and the runner only gathers the facts.
 */

export interface Observation {
  /** The fake HOME the run used. */
  home: string;
  /** The project directory the fixture was copied to. */
  project: string;
  /** Where `.forger/` was found: the directories that hold one. */
  forgerDirs: string[];
  /** The text of the written config. */
  config: string;
  /** Pack ids `packs --detect` suggested before setup. */
  detected: string[];
  /** The `coverage` advice in setup's JSON output, absent when setup gave none. */
  coverage?: {report_present: boolean; gates_write_report: boolean};
  /** Whether the lcov report exists after the gates ran. */
  reportWritten: boolean;
  /** True for a project with no source file, where setup copies a starter and detection has nothing to read. */
  starter?: boolean;
}

export interface Failure {
  /** The demo-week issue the assertion guards. */
  issue: number;
  message: string;
}

const HOME_PATH = /(\/home\/|\/Users\/|\/root\/)/;

export function checkObservation(o: Observation): Failure[] {
  const out: Failure[] = [];
  const fail = (issue: number, message: string) => out.push({issue, message});

  if (o.forgerDirs.length !== 1 || o.forgerDirs[0] !== o.project) {
    fail(183, `setup found the wrong project root: .forger/ is in [${o.forgerDirs.join(', ')}], expected only ${o.project}`);
  }
  if (o.config.includes(o.home) || HOME_PATH.test(o.config)) {
    fail(184, 'the written config holds an absolute home path');
  }
  if (!o.starter && !o.detected.includes('testing')) {
    fail(185, `packs --detect did not suggest the testing pack (got: ${o.detected.join(', ') || 'nothing'})`);
  }
  if (!o.coverage) {
    fail(186, 'setup gave no coverage advice although the testing pack was installed');
  } else if (!o.coverage.gates_write_report) {
    fail(186, 'setup says the gates do not write the coverage report');
  } else if (!o.reportWritten) {
    fail(186, 'the gates ran without writing the coverage report');
  }
  return out;
}
