/**
 * Contract-driven preload invokers.
 *
 * Builds `(...args) => ipcRenderer.invoke(channel, ...args)` for each method of
 * a channel map (`skillsContractChannels` etc.). The channel maps carry plain
 * string constants — no zod — so the sandboxed preload bundle (which cannot
 * require node modules) stays zod-free while the method list stays locked to
 * the contract via `IpcContractChannels<typeof contract>`.
 */
import { ipcRenderer } from 'electron';
import type { IpcContractChannels, IpcEventApi, IpcEventDefinition } from '../../shared/ipc/contract';

export function createIpcInvokers<Channels extends Record<string, string>>(
  channels: Channels,
): { [K in keyof Channels]: (...args: unknown[]) => Promise<unknown> } {
  const invokers = {} as { [K in keyof Channels]: (...args: unknown[]) => Promise<unknown> };
  for (const method of Object.keys(channels) as Array<keyof Channels & string>) {
    const channel = channels[method];
    invokers[method] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
  }
  return invokers;
}

export function createIpcEventSenders<Contract extends Readonly<Record<string, IpcEventDefinition>>>(
  channels: IpcContractChannels<Contract>,
): IpcEventApi<Contract> {
  return Object.fromEntries(
    Object.entries<string>(channels).map(([name, channel]) => [
      name,
      (...args: unknown[]) => ipcRenderer.send(channel, ...args),
    ]),
  ) as IpcEventApi<Contract>;
}
