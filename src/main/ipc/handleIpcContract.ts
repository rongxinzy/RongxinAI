/**
 * Contract-based `ipcMain.handle` registration.
 *
 * `handleIpcContract(contract, impls)` registers one handler per contract
 * method. Arguments are runtime-validated with the contract's zod tuple before
 * the impl runs; invalid input rejects with an error that names the channel
 * and summarizes the zod issues. Results are NOT validated in production
 * (per-call cost on every IPC reply); `contract-result` unit tests pin impl
 * outputs to the result schemas instead.
 */
import { ipcMain } from 'electron';
import { z } from 'zod';

import type {
  IpcContract,
  IpcContractHandlers,
  IpcInvokeEventLike,
} from '../../shared/ipc/contract';

/** Compact one-line summary of a zod failure, e.g. `0: expected string` / `name: required`. */
function summarizeZodIssues(error: z.ZodError): string {
  return error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

/**
 * Register every contract method on `ipcMain`. The impl receives the parsed,
 * typed args; a zod failure rejects the renderer invoke with
 * `Error("IPC <channel> rejected invalid arguments: <summary>")` and the impl
 * is never called.
 */
export function handleIpcContract<C extends IpcContract>(
  contract: C,
  impls: IpcContractHandlers<C>,
): void {
  for (const method of Object.keys(contract) as Array<keyof C & string>) {
    const definition = contract[method];
    ipcMain.handle(definition.channel, async (event, ...rawArgs: unknown[]) => {
      const parsedArgs = definition.args.safeParse(rawArgs);
      if (!parsedArgs.success) {
        throw new Error(
          `IPC ${definition.channel} rejected invalid arguments: ${summarizeZodIssues(parsedArgs.error)}`,
        );
      }
      const impl = impls[method] as (event: IpcInvokeEventLike, ...args: unknown[]) => unknown;
      return impl(event, ...parsedArgs.data);
    });
  }
}
