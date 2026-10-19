export type PythonExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  environmentId: string;
  runtimeId: string;
  truncated: boolean;
};
export type PythonExecuteInput = {
  workspace: string;
  code: string;
  timeoutMs?: number;
  runtimeId?: string;
};
export type PythonInstallInput = {
  workspace: string;
  packages: string[];
  rebuild?: boolean;
  timeoutMs?: number;
  runtimeId?: string;
};
export type PythonRunnerRequest = {
  operation: 'execute' | 'install';
  input: PythonExecuteInput | PythonInstallInput;
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
  };
};
export type PythonRunnerResponse =
  | { success: true; result: PythonExecutionResult }
  | { success: false; error: string };
