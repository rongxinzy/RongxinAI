// Disposable real Win32 message boxes for the acceptance driver's HWND tests.
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;

namespace ZhiYuan.Acceptance {
  public sealed class DialogFixture : IDisposable {
    private delegate bool EnumProc(IntPtr window, IntPtr state);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateWindowEx(uint extendedStyle, string className, string text,
      uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBox(IntPtr owner, string text, string caption, uint type);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool EnumThreadWindows(uint thread, EnumProc callback, IntPtr state);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")] private static extern int SetWindowLong(IntPtr window, int index, int value);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] private static extern bool EnableWindow(IntPtr window, bool enabled);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool SetWindowText(IntPtr window, string text);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    private readonly Thread thread;
    private readonly ManualResetEvent ready = new ManualResetEvent(false);
    private uint threadId;
    private Exception failure;
    public long Owner { get; private set; }
    public int Result { get; private set; }

    public DialogFixture(string title, string message) {
      thread = new Thread(() => {
        try {
          threadId = GetCurrentThreadId();
          var owner = CreateWindowEx(0, "STATIC", "Acceptance dialog owner", 0x10C80000,
            100, 100, 460, 250, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
          if (owner == IntPtr.Zero) throw new Win32Exception();
          Owner = owner.ToInt64();
          ready.Set();
          try { Result = MessageBox(owner, message, title, 0x30); }
          finally { DestroyWindow(owner); }
        } catch (Exception error) { failure = error; ready.Set(); }
      });
      thread.IsBackground = true;
      thread.SetApartmentState(ApartmentState.STA);
      thread.Start();
      if (!ready.WaitOne(5000)) throw new TimeoutException("Native dialog owner did not open");
      if (failure != null) throw failure;
    }

    public static void SetId(long button, int id) {
      SetWindowLong(new IntPtr(button), -12, id);
      if (GetDlgCtrlID(new IntPtr(button)) != id) throw new InvalidOperationException("Could not remap the real dialog button ID");
    }
    public static void SetEnabled(long window, bool enabled) { EnableWindow(new IntPtr(window), enabled); }
    public static void SetVisible(long window, bool visible) { ShowWindow(new IntPtr(window), visible ? 5 : 0); }
    public static void SetText(long window, string text) { SetWindowText(new IntPtr(window), text); }
    public static long AddButton(long dialog) {
      var button = CreateWindowEx(0, "BUTTON", "OK", 0x50000000, 10, 10, 60, 24,
        new IntPtr(dialog), new IntPtr(77), IntPtr.Zero, IntPtr.Zero);
      if (button == IntPtr.Zero) throw new Win32Exception();
      return button.ToInt64();
    }
    public static void RemoveButton(long button) {
      if (!DestroyWindow(new IntPtr(button))) throw new Win32Exception();
    }
    public bool WaitForExit(int milliseconds) { return thread.Join(milliseconds); }
    public void Dispose() {
      if (thread.IsAlive) {
        EnumThreadWindows(threadId, (window, state) => {
          if (GetWindow(window, 4).ToInt64() == Owner) PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
          return true;
        }, IntPtr.Zero);
        if (!thread.Join(5000)) throw new TimeoutException("Native fixture dialog did not close");
      }
      ready.Dispose();
    }
  }
}
