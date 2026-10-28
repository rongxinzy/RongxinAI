// Koffi is MIT; see public/licenses/koffi.txt.
import koffi from 'koffi';
import path from 'node:path';
import { WINDOW_SENSOR_MAX_WINDOWS } from '../../../shared/desktopPet/surfaces/constants';
import type { NativeWindowFrame } from '../../../shared/desktopPet/surfaces/types';
import { NativeWindowFlag as Flag, WINDOW_SENSOR_MAX_VISITED } from './constants';

/** Function signatures match Win32's fixed-width fields, not the host's C long size. */
interface WinApi {
  top: (parent: unknown) => unknown;
  next: (window: unknown, relationship: number) => unknown;
  visible: (window: unknown) => number;
  minimized: (window: unknown) => number;
  foreground: () => unknown;
  className: (window: unknown, result: Buffer, count: number) => number;
  style: (window: unknown, index: number) => number | bigint;
  attribute: (window: unknown, attribute: number, result: Buffer, size: number) => number;
  awareness: (context: number | bigint) => number | bigint;
  hook: (
    min: number,
    max: number,
    module: null,
    callback: bigint,
    processId: number,
    threadId: number,
    flags: number,
  ) => unknown;
  unhook: (handle: unknown) => number;
  peek: (message: Buffer, window: null, min: number, max: number, flags: number) => number;
  translate: (message: Buffer) => number;
  dispatch: (message: Buffer) => number | bigint;
}

const shellClasses = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);
const handleId = (handle: unknown): string | null =>
  handle ? koffi.address(handle).toString(16) : null;

export function createNativeWindows(changed: () => void, excluded: () => ReadonlySet<string>) {
  if (process.platform !== 'win32' || !['x64', 'arm64'].includes(process.arch))
    throw new Error('Window surfaces require 64-bit Windows');
  const root = process.env.SystemRoot;
  if (!root || !path.win32.isAbsolute(root))
    throw new Error('Windows system directory is unavailable');
  const user = koffi.load(path.win32.join(root, 'System32', 'user32.dll'));
  const dwm = koffi.load(path.win32.join(root, 'System32', 'dwmapi.dll'));
  const api: WinApi = {
    top: user.func('void * __stdcall GetTopWindow(void *parent)'),
    next: user.func('void * __stdcall GetWindow(void *window, uint32_t command)'),
    visible: user.func('int32_t __stdcall IsWindowVisible(void *window)'),
    minimized: user.func('int32_t __stdcall IsIconic(void *window)'),
    foreground: user.func('void * __stdcall GetForegroundWindow()'),
    className: user.func(
      'int32_t __stdcall GetClassNameW(void *window, _Out_ uint16_t *name, int32_t count)',
    ),
    style: user.func('intptr_t __stdcall GetWindowLongPtrW(void *window, int32_t index)'),
    attribute: dwm.func(
      'int32_t __stdcall DwmGetWindowAttribute(void *window, uint32_t attribute, _Out_ void *value, uint32_t size)',
    ),
    awareness: user.func('intptr_t __stdcall SetThreadDpiAwarenessContext(intptr_t context)'),
    hook: user.func(
      'void * __stdcall SetWinEventHook(uint32_t min, uint32_t max, void *module, void *callback, uint32_t processId, uint32_t threadId, uint32_t flags)',
    ),
    unhook: user.func('int32_t __stdcall UnhookWinEvent(void *hook)'),
    peek: user.func(
      'int32_t __stdcall PeekMessageW(_Out_ void *message, void *window, uint32_t min, uint32_t max, uint32_t remove)',
    ),
    translate: user.func('int32_t __stdcall TranslateMessage(const void *message)'),
    dispatch: user.func('intptr_t __stdcall DispatchMessageW(const void *message)'),
  };
  // DWM frame bounds are physical pixels; keep all helper APIs in the same coordinate space.
  const previousAwareness = api.awareness(-4);
  if (!previousAwareness) throw new Error('Per-monitor DPI awareness could not be established');
  const callbackType = koffi.proto(
    'void __stdcall SurfaceWinEvent(void *hook, uint32_t event, void *window, int32_t object, int32_t child, uint32_t thread, uint32_t time)',
  );
  const callback = koffi.register(
    (_hook: unknown, event: number, window: unknown, object: number) => {
      const id = handleId(window);
      if (id && excluded().has(id)) return;
      if (event < Flag.ObjectCreate || object === 0) changed();
    },
    koffi.pointer(callbackType),
  );
  const hooks: unknown[] = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const hook of hooks) api.unhook(hook);
    koffi.unregister(callback);
    api.awareness(previousAwareness);
  };
  try {
    for (const [min, max] of [
      [Flag.ObjectCreate, Flag.ObjectLocation],
      [Flag.Foreground, Flag.Foreground],
      [Flag.MinimizeStart, Flag.MinimizeEnd],
    ]) {
      const hook = api.hook(min, max, null, callback, 0, 0, Flag.SkipOwnProcess);
      if (!hook) throw new Error('Window event hook could not be installed');
      hooks.push(hook);
    }
  } catch (error) {
    close();
    throw error;
  }
  const message = Buffer.alloc(48); // MSG is 48 bytes on both Windows x64 and ARM64.
  const classBuffer = Buffer.alloc(256);
  const frame = Buffer.alloc(16);
  const cloak = Buffer.alloc(4);
  return {
    pump() {
      for (
        let count = 0;
        count < 32 && api.peek(message, null, 0, 0, Flag.RemoveMessage);
        count++
      ) {
        api.translate(message);
        api.dispatch(message);
      }
    },
    sample(): { windows: NativeWindowFrame[]; foreground: string | null } {
      const windows: NativeWindowFrame[] = [];
      const visited = new Set<string>();
      let handle = api.top(null);
      // GetWindow's order is explicit. Both a count and cycle guard bound destroyed/reordered HWNDs.
      for (
        let count = 0;
        handle && count < WINDOW_SENSOR_MAX_VISITED && windows.length < WINDOW_SENSOR_MAX_WINDOWS;
        count++
      ) {
        const id = handleId(handle);
        if (!id || visited.has(id)) break;
        visited.add(id);
        const current = handle;
        handle = api.next(current, Flag.Next);
        if (excluded().has(id) || !api.visible(current) || api.minimized(current)) continue;
        const length = api.className(current, classBuffer, 128);
        if (length <= 0 || shellClasses.has(classBuffer.toString('utf16le', 0, length * 2)))
          continue;
        if (
          api.attribute(current, Flag.Cloaked, cloak, cloak.length) !== 0 ||
          cloak.readUInt32LE(0)
        )
          continue;
        if (api.attribute(current, Flag.ExtendedFrameBounds, frame, frame.length) !== 0) continue;
        const rect = {
          x: frame.readInt32LE(0),
          y: frame.readInt32LE(4),
          width: frame.readInt32LE(8) - frame.readInt32LE(0),
          height: frame.readInt32LE(12) - frame.readInt32LE(4),
        };
        if (rect.width <= 0 || rect.height <= 0 || rect.width > 100_000 || rect.height > 100_000)
          continue;
        const style = BigInt(api.style(current, Flag.ExtendedStyle));
        // Translucent/tool windows still occlude lower ledges, but are never a climbing target.
        const attachable =
          rect.width >= 80 &&
          rect.height >= 60 &&
          !(style & (Flag.ToolWindow | Flag.Layered | Flag.Transparent));
        windows.push({ id, rect, attachable });
      }
      return { windows, foreground: handleId(api.foreground()) };
    },
    close,
  };
}
