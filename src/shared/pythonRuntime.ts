import type { PythonRuntimeOperation } from './pythonRuntime/constants';

export type PythonExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  environmentId: string;
  runtimeId: string;
  truncated: boolean;
  /** Host-only environment location, also used by long-lived Skill processes. */
  pythonPath?: string;
};
export type PythonSkillDependencies = {
  skillId: string;
  requirementsPath: string;
  confirmDependencyInstall?: boolean;
};

export type PythonPrepareInput = {
  workspace: string;
  skill?: PythonSkillDependencies;
  timeoutMs?: number;
  runtimeId?: string;
};
export type PythonPreparedEnvironment = {
  pythonPath: string;
  environmentId: string;
  runtimeId: string;
};

export type PythonExecuteInput = PythonPrepareInput &
  (
    | { code: string; scriptPath?: never; args?: never }
    | {
        code?: never;
        scriptPath: string;
        args?: string[];
      }
  ) & {
    /** Host-supplied Skill environment; scripts never inherit application credentials. */
    env?: Record<string, string | undefined>;
  };
export type PythonInstallInput = PythonPrepareInput & {
  packages: string[];
  rebuild?: boolean;
};
export type PythonRunnerRequest = {
  operation: (typeof PythonRuntimeOperation)[keyof typeof PythonRuntimeOperation];
  input: PythonExecuteInput | PythonInstallInput | PythonPrepareInput;
  storageRoot: string;
  jobRunnerPath?: string;
  /**
   * The bundled managed runtime (work package G): absolute interpreter and uv
   * paths from the packaged build. The runner never downloads a runtime —
   * when this is absent the operation fails with a reinstall hint.
   */
  preinstalledRuntime?: {
    pythonPath: string;
    uvPath: string;
    runtimeId: string;
    /** Packaged dependency baseline; copied into each workspace, never modified in place. */
    sharedPythonPath?: string;
  };
  /** Shared uv cache (defaults to <storageRoot>/uv-cache). uv locks safely across processes. */
  uvCacheDir?: string;
};
export type PythonRunnerResponse =
  | { success: true; result: PythonExecutionResult }
  | { success: false; error: string };
