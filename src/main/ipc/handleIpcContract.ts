/**
 * Contract-based `ipcMain.handle` registration.
 *
 * `handleIpcContract(contract, impls)` registers one handler per contract
 * method. Arguments are runtime-validated with the contract's zod tuple before
 * the impl runs; invalid input rejects with an error that names the channel
 * and summarizes the zod issues. Results are NOT validated in production
 * (per-call cost on every IPC reply); `contract-result` unit tests pin impl
 * outputs to the result schemas instead.
 *
 * When one contract spans several registration files (the appSystem contract
 * covers store, dialogs, shell, update, …), each file registers its own subset
 * with `handleIpcContractSubset`; the full-map variant is for single-file
 * domains like skills.
 */
import type { IpcMainInvokeEvent } from 'electron';
import { ipcMain } from 'electron';
import { z } from 'zod';

import type { IpcContract, IpcContractHandlers } from '../../shared/ipc/contract';

/** Compact one-line summary of a zod failure, e.g. `0: expected string` / `name: required`. */
function summarizeZodIssues(error: z.ZodError): string {
  return error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

function registerContractMethods<C extends IpcContract>(
  contract: C,
  methods: ReadonlyArray<keyof C & string>,
  impls: Partial<
    Record<keyof C & string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>
  >,
): void {
  for (const method of methods) {
    const definition = contract[method];
    const impl = impls[method];
    if (!impl) throw new Error(`IPC contract method ${method} has no handler`);
    ipcMain.handle(definition.channel, async (event, ...rawArgs: unknown[]) => {
      const parsedArgs = definition.args.safeParse(rawArgs);
      if (!parsedArgs.success) {
        throw new Error(
          `IPC ${definition.channel} rejected invalid arguments: ${summarizeZodIssues(parsedArgs.error)}`,
        );
      }
      return impl(event, ...parsedArgs.data);
    });
  }
}

/**
 * Register every contract method on `ipcMain`. The impl receives the parsed,
 * typed args and the full `Electron.IpcMainInvokeEvent`; a zod failure rejects
 * the renderer invoke with
 * `Error("IPC <channel> rejected invalid arguments: <summary>")` and the impl
 * is never called.
 */
export function handleIpcContract<C extends IpcContract>(
  contract: C,
  impls: IpcContractHandlers<C, IpcMainInvokeEvent>,
): void {
  registerContractMethods(
    contract,
    Object.keys(contract) as Array<keyof C & string>,
    impls as never,
  );
}

/**
 * Register only the methods present in `impls` (same validation semantics as
 * `handleIpcContract`); for contracts whose handlers live in several
 * registration files. Each method must be registered by exactly one subset.
 */
export function handleIpcContractSubset<C extends IpcContract, K extends keyof C & string>(
  contract: C,
  impls: { [P in K]: IpcContractHandlers<C, IpcMainInvokeEvent>[P] },
): void {
  registerContractMethods(contract, Object.keys(impls) as K[], impls as never);
}
