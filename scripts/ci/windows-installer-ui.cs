// Real HWND inspection/interaction for the packaged NSIS acceptance gate.
// No installer test hooks, generated screenshots, or hidden Next-button clicks.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace ZhiYuan.Acceptance {
  public sealed class WindowInfo {
    public long Handle;
    public int ProcessId;
    public int ControlId;
    public string ClassName;
    public string Text;
    public bool Visible;
    public bool Enabled;
    public int Left;
    public int Top;
    public int Width;
    public int Height;
    public uint Dpi;
  }

  public static class InstallerUi {
    [StructLayout(LayoutKind.Sequential)] private struct Rect {
      public int Left, Top, Right, Bottom;
    }
    [StructLayout(LayoutKind.Sequential)] private struct FileInformation {
      public uint Attributes;
      public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime, LastAccessTime, LastWriteTime;
      public uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation information);
    private delegate bool EnumProc(IntPtr window, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, IntPtr state);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr state);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] private static extern int MapWindowPoints(IntPtr from, IntPtr to, ref Rect rect, uint points);
    [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int DrawText(IntPtr dc, string text, int length, ref Rect rect, uint format);
    [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr value);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] private static extern int GetWindowLong(IntPtr window, int index);

    public static void UsePhysicalCoordinates() {
      // This changes only the harness coordinate system, never the installer's
      // DPI. Report the actual installer DPI; do not claim simulated coverage.
      SetThreadDpiAwarenessContext(new IntPtr(-4));
    }

    public static string DirectoryIdentity(string path, bool allowMissing) {
      // Identify the real filesystem object, not its name, timestamp or bytes.
      // Share read/write/delete and close immediately, so this observation does
      // not prevent an actual installer rename or background backup cleanup.
      // BACKUP_SEMANTICS | OPEN_REPARSE_POINT avoids following a substituted link.
      using (var directory = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero)) {
        if (directory.IsInvalid) {
          var error = Marshal.GetLastWin32Error();
          if (allowMissing && (error == 2 || error == 3)) return null;
          throw new Win32Exception(error, "Cannot identify directory: " + path);
        }
        FileInformation information;
        if (!GetFileInformationByHandle(directory, out information)) throw new Win32Exception();
        if ((information.Attributes & 0x10) == 0 || (information.Attributes & 0x400) != 0)
          throw new InvalidOperationException("Expected a real directory, not a file or reparse point: " + path);
        return information.VolumeSerialNumber.ToString("X8") + ":" +
          information.FileIndexHigh.ToString("X8") + information.FileIndexLow.ToString("X8");
      }
    }

    private static WindowInfo Inspect(IntPtr window) {
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      var text = new StringBuilder(4096);
      var className = new StringBuilder(256);
      GetWindowText(window, text, text.Capacity);
      GetClassName(window, className, className.Capacity);
      Rect bounds;
      if (!GetWindowRect(window, out bounds)) throw new Win32Exception();
      return new WindowInfo {
        Handle = window.ToInt64(), ProcessId = (int)processId,
        ControlId = GetDlgCtrlID(window), ClassName = className.ToString(),
        Text = text.ToString(), Visible = IsWindowVisible(window),
        Enabled = IsWindowEnabled(window), Left = bounds.Left, Top = bounds.Top,
        Width = bounds.Right - bounds.Left, Height = bounds.Bottom - bounds.Top,
        Dpi = GetDpiForWindow(window)
      };
    }

    public static WindowInfo[] Windows() {
      var windows = new List<WindowInfo>();
      EnumWindows((window, state) => {
        if (IsWindowVisible(window)) windows.Add(Inspect(window));
        return true;
      }, IntPtr.Zero);
      return windows.ToArray();
    }

    public static WindowInfo[] Controls(long parent) {
      var controls = new List<WindowInfo>();
      EnumChildWindows(new IntPtr(parent), (window, state) => {
        controls.Add(Inspect(window));
        return true;
      }, IntPtr.Zero);
      return controls.ToArray();
    }

    public static int Checked(long handle) {
      return SendMessage(new IntPtr(handle), 0x00F0, IntPtr.Zero, IntPtr.Zero).ToInt32();
    }

    public static void Click(long handle) {
      var window = new IntPtr(handle);
      var control = Inspect(window);
      if (!control.Visible || !control.Enabled || control.ClassName != "Button")
        throw new InvalidOperationException("Cannot click an invisible, disabled, or non-button control: " + control.Text);
      // BM_CLICK reaches the same NSIS control callback as a user click.
      // Posting keeps the driver responsive during real synchronous install work.
      if (!PostMessage(window, 0x00F5, IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
    }

    public static void Close(long handle) {
      if (!PostMessage(new IntPtr(handle), 0x0010, IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception();
    }

    public static void AssertActionLayout(long parent, long handle) {
      var window = new IntPtr(handle);
      var control = Inspect(window);
      if (!control.Visible || control.Width <= 0 || control.Height <= 0)
        throw new InvalidOperationException("Action is not visible: " + control.Text);
      Rect client;
      GetClientRect(new IntPtr(parent), out client);
      MapWindowPoints(new IntPtr(parent), IntPtr.Zero, ref client, 2);
      if (control.Left < client.Left || control.Top < client.Top ||
          control.Left + control.Width > client.Right || control.Top + control.Height > client.Bottom)
        throw new InvalidOperationException("Action is clipped by the wizard: " + control.Text);
      var dc = GetDC(window);
      var font = SendMessage(window, 0x0031, IntPtr.Zero, IntPtr.Zero);
      var oldFont = font == IntPtr.Zero ? IntPtr.Zero : SelectObject(dc, font);
      try {
        var measured = new Rect();
        // DT_CALCRECT | DT_SINGLELINE. Ampersands are access-key markers.
        DrawText(dc, control.Text, -1, ref measured, 0x0420);
        Rect inner;
        GetClientRect(window, out inner);
        var style = GetWindowLong(window, -16) & 0xF;
        var checkbox = style == 2 || style == 3 || style == 5 || style == 6;
        var allowance = checkbox ? (int)Math.Ceiling(20 * control.Dpi / 96.0) : 8;
        if (measured.Right - measured.Left + allowance > inner.Right - inner.Left ||
            measured.Bottom - measured.Top > inner.Bottom - inner.Top)
          throw new InvalidOperationException("Action text does not fit at " + control.Dpi + " DPI: " + control.Text);
      } finally {
        if (oldFont != IntPtr.Zero) SelectObject(dc, oldFont);
        ReleaseDC(window, dc);
      }
    }

    public static void Capture(long handle, string path) {
      var window = new IntPtr(handle);
      var info = Inspect(window);
      if (!info.Visible || info.Width <= 0 || info.Height <= 0)
        throw new InvalidOperationException("Cannot capture an invisible window");
      SetForegroundWindow(window);
      using (var bitmap = new Bitmap(info.Width, info.Height)) {
        using (var graphics = Graphics.FromImage(bitmap)) {
          var dc = graphics.GetHdc();
          try {
            if (!PrintWindow(window, dc, 2)) throw new Win32Exception("PrintWindow failed");
          } finally { graphics.ReleaseHdc(dc); }
        }
        var colors = new HashSet<int>();
        for (int y = 0; y < bitmap.Height; y += 7)
          for (int x = 0; x < bitmap.Width; x += 7) colors.Add(bitmap.GetPixel(x, y).ToArgb());
        if (colors.Count < 8) throw new InvalidOperationException("Window capture is blank; interactive desktop evidence is unavailable");
        bitmap.Save(path, ImageFormat.Png);
      }
    }
  }
}
