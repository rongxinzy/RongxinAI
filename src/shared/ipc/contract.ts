/**
 * Typed IPC contract infrastructure.
 *
 * A contract binds three hand-written copies of every IPC method — the main
 * `ipcMain.handle` registration, the preload invoker, and the renderer-facing
 * `window.electron` types — to a single zod-backed definition:
 *
 *   const mathContract = defineIpcContract({
 *     add: { channel: 'math:add', args: z.tuple([z.number(), z.number()]), result: z.number() },
 *   });
 *
 * Layering (sandboxed preload must not require zod, so the contract splits):
 *   - `IpcContractChannels<C>` — channel names only, zod-free value type.
 *     The preload imports *only* this (via a plain channel-map constant), so
 *     `createIpcInvokers` never pulls zod into the sandboxed bundle.
 *   - `IpcContractApi<C>` — renderer-facing `(…args) => Promise<result>`.
 *   - `IpcContractHandlers<C>` — main-side impl signatures; `args` are the
 *     zod-parsed outputs and `result` is checked at compile time.
 *
 * Channel values come from the `Ipc*` constant objects in `src/shared/ipc/channels.ts`
 * (or domain constants like `src/shared/marketplace/constants.ts`) — never bare
 * string literals, per AGENTS.md「字符串常量」.
 */
import type { z } from 'zod';

/** One IPC method: channel constant + argument tuple schema + result schema. */
interface IpcContractMethod {
  readonly channel: string;
  readonly args: z.ZodTuple;
  readonly result: z.ZodType;
}

/** A contract: method name → method definition, `as const` via defineIpcContract. */
export type IpcContract = Readonly<Record<string, IpcContractMethod>>;

/**
 * Define a contract. The identity function exists so the object literal keeps
 * precise per-method literal types (`as const`) while still satisfying
 * `IpcContract` for the helpers below.
 */
export function defineIpcContract<C extends IpcContract>(contract: C): C {
  return contract;
}

/**
 * Renderer-facing API derived from a contract: each method takes the zod
 * *input* of its args tuple (as rest parameters, so optional trailing tuple
 * elements stay optional) and resolves to the zod *output* of its result.
 */
export type IpcContractApi<C extends IpcContract> = {
  [K in keyof C]: (...args: z.input<C[K]['args']>) => Promise<z.output<C[K]['result']>>;
};

/**
 * Main-side impl map for `handleIpcContract`: impls receive the zod *output*
 * of the args tuple (already validated) and must return the result type the
 * result schema infers — checked at compile time, not runtime.
 *
 * The `event` parameter is typed loosely (a structural subset of
 * `Electron.IpcMainInvokeEvent`) because this shared module compiles in both
 * the renderer tsconfig (where the `Electron` ambient namespace may be
 * unavailable) and the main tsconfig.
 */
export interface IpcInvokeEventLike {
  readonly sender: {
    readonly id: number;
  };
}

export type IpcContractHandlers<C extends IpcContract> = {
  [K in keyof C]: (
    event: IpcInvokeEventLike,
    ...args: z.output<C[K]['args']>
  ) => z.output<C[K]['result']> | Promise<z.output<C[K]['result']>>;
};

/** Channel map for a contract: method name → channel constant. Zod-free values. */
export type IpcContractChannels<C extends IpcContract> = Readonly<{
  [K in keyof C]: C[K]['channel'];
}>;
