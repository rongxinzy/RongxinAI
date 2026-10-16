// Real HWND inspection/interaction for the packaged NSIS acceptance gate.
// No installer test hooks, generated screenshots, or hidden Next-button clicks.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

namespace ZhiYuan.Acceptance {
  public sealed class ActionFontContract {
    public string Family;
    public int Points, BodyWeight, ButtonWeight;
  }

  public sealed class WindowInfo {
    public long Handle;
    public long ParentHandle;
    public long OwnerHandle;
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
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
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
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode, EntryPoint = "CreateFontW")]
    private static extern IntPtr CreateFont(int height, int width, int escapement, int orientation,
      int weight, uint italic, uint underline, uint strikeout, uint charset,
      uint outputPrecision, uint clipPrecision, uint quality, uint pitch, string family);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr value);
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
        ParentHandle = GetParent(window).ToInt64(),
        OwnerHandle = GetWindow(window, 4).ToInt64(),
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

    public static WindowInfo[] ProgressControls(long wizard) {
      // ZYProgressShow creates these statics directly on $HWNDPARENT.
      // nsDialogs restarts IDs at 1200 inside every hero/finish child dialog,
      // so descendant IDs alone do not identify a progress control.
      var controls = new List<WindowInfo>();
      foreach (var control in Controls(wizard)) {
        if (control.ParentHandle == wizard && control.ControlId >= 1200 && control.ControlId <= 1206)
          controls.Add(control);
      }
      return controls.ToArray();
    }

    public static bool HasBrandedProgress(long wizard, string expectedTitle) {
      var controls = ProgressControls(wizard);
      if (controls.Length != 7) return false;
      var ids = new HashSet<int>();
      bool titleVisible = false;
      foreach (var control in controls) {
        if (control.ClassName != "Static" || !ids.Add(control.ControlId)) return false;
        if (control.ControlId == 1201)
          titleVisible = control.Visible && control.Text == expectedTitle;
      }
      return titleVisible;
    }

    public static void AssertProgressRemoved(long wizard) {
      var controls = ProgressControls(wizard);
      if (controls.Length != 0) {
        var first = controls[0];
        // Hidden controls still leak wizard-owned resources and must be gone.
        throw new InvalidOperationException("Wizard-owned progress controls were not destroyed: " +
          controls.Length + "; first id=" + first.ControlId + "; visible=" + first.Visible + "; text=" + first.Text);
      }
    }

    public static int Checked(long handle) {
      return SendMessage(new IntPtr(handle), 0x00F0, IntPtr.Zero, IntPtr.Zero).ToInt32();
    }

    public static WindowInfo FindDialogAcknowledgement(long dialog, int expectedProcessId,
      string expectedTitle, string expectedBodyPattern, long expectedOwner) {
      var info = Inspect(new IntPtr(dialog));
      if (!info.Visible || !info.Enabled || info.ClassName != "#32770" ||
          info.ProcessId != expectedProcessId || info.Text != expectedTitle) return null;
      if (expectedOwner != 0) {
        if (info.OwnerHandle != expectedOwner) return null;
        var owner = Inspect(new IntPtr(expectedOwner));
        if (owner.ProcessId != expectedProcessId || !owner.Visible || owner.Enabled) return null;
      }
      var buttons = new List<WindowInfo>();
      bool hasExpectedBody = false;
      foreach (var control in Controls(dialog)) {
        if (!control.Visible || control.ProcessId != expectedProcessId) continue;
        if (control.ClassName == "Button") buttons.Add(control);
        if (control.ClassName == "Static" && Regex.IsMatch(control.Text, expectedBodyPattern,
            RegexOptions.CultureInvariant)) hasExpectedBody = true;
      }
      if (!hasExpectedBody || buttons.Count != 1 || !buttons[0].Enabled) return null;
      var label = Regex.Replace(buttons[0].Text.Replace("&", ""), @"\s*\([A-Za-z]\)", "").Trim();
      // MB_OK may expose IDCANCEL (2) as the child ID while still returning
      // IDOK (1). Match the unique visible acknowledgement, never a guessed ID.
      if (!String.Equals(label, "OK", StringComparison.OrdinalIgnoreCase) &&
          label != "\u786e\u5b9a" && label != "\u78ba\u5b9a") return null;
      return buttons[0];
    }

    public static void ClickDialogAcknowledgement(long dialog, int expectedProcessId,
      string expectedTitle, string expectedBodyPattern, long expectedOwner) {
      var button = FindDialogAcknowledgement(dialog, expectedProcessId, expectedTitle,
        expectedBodyPattern, expectedOwner);
      if (button == null)
        throw new InvalidOperationException("Expected unique acknowledgement dialog is no longer available");
      Click(button.Handle);
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

    public static ActionFontContract ReadActionFontContract(string themePath) {
      var theme = System.IO.File.ReadAllText(themePath);
      Func<string, string, string> read = (name, pattern) => {
        var matches = System.Text.RegularExpressions.Regex.Matches(theme,
          "(?m)^!define[ \\t]+" + name + "[ \\t]+" + pattern + "[ \\t]*(?:;[^\\r\\n]*)?\\r?$");
        if (matches.Count != 1) throw new InvalidOperationException("Missing or ambiguous production font token: " + name);
        return matches[0].Groups[1].Value;
      };
      return new ActionFontContract {
        Family = read("ZY_FONT_FAMILY", "\"([^\"]+)\""),
        Points = int.Parse(read("ZY_FONT_BODY_SIZE", "([0-9]+)")),
        BodyWeight = int.Parse(read("ZY_FONT_BODY_WT", "([0-9]+)")),
        ButtonWeight = int.Parse(read("ZY_FONT_BUTTON_WT", "([0-9]+)"))
      };
    }

    public static void AssertActionLayout(long parent, long handle, string family, int points, int weight) {
      var window = new IntPtr(handle);
      var control = Inspect(window);
      if (!control.Visible || control.Width <= 0 || control.Height <= 0)
        throw new InvalidOperationException("Action is not visible: " + control.Text);
      Rect client;
      if (!GetClientRect(new IntPtr(parent), out client)) throw new Win32Exception();
      MapWindowPoints(new IntPtr(parent), IntPtr.Zero, ref client, 2);
      if (control.Left < client.Left || control.Top < client.Top ||
          control.Left + control.Width > client.Right || control.Top + control.Height > client.Bottom)
        throw new InvalidOperationException("Action is clipped by the wizard: " + control.Text);
      if (string.IsNullOrWhiteSpace(family) || points <= 0 || points > 72 || weight <= 0 || weight > 1000 || control.Dpi == 0)
        throw new InvalidOperationException("Invalid production font contract or actual window DPI");
      // WM_GETFONT returns the other process's private HFONT, which cannot be
      // selected into our DC. Recreate the production theme contract locally
      // at the real HWND DPI; never silently measure with the default font.
      // https://learn.microsoft.com/windows/win32/sysinfo/gdi-objects
      var height = -(int)Math.Round(points * control.Dpi / 72.0, MidpointRounding.AwayFromZero);
      var font = CreateFont(height, 0, 0, 0, weight, 0, 0, 0, 1, 0, 0, 0, 0, family);
      if (font == IntPtr.Zero) throw new InvalidOperationException("Could not create the production measurement font");
      var dc = IntPtr.Zero;
      var oldFont = IntPtr.Zero;
      try {
        dc = GetDC(window);
        if (dc == IntPtr.Zero) throw new InvalidOperationException("Could not obtain control measurement DC");
        oldFont = SelectObject(dc, font);
        if (oldFont == IntPtr.Zero || oldFont == new IntPtr(-1))
          throw new InvalidOperationException("Could not select the production measurement font");
        var measured = new Rect();
        // DT_CALCRECT | DT_SINGLELINE. Ampersands are access-key markers.
        if (DrawText(dc, control.Text, -1, ref measured, 0x0420) <= 0)
          throw new InvalidOperationException("Could not measure action text: " + control.Text);
        Rect inner;
        if (!GetClientRect(window, out inner)) throw new Win32Exception();
        var style = GetWindowLong(window, -16) & 0xF;
        var checkbox = style == 2 || style == 3 || style == 5 || style == 6;
        var allowance = checkbox ? (int)Math.Ceiling(20 * control.Dpi / 96.0) : 8;
        if (measured.Right - measured.Left + allowance > inner.Right - inner.Left ||
            measured.Bottom - measured.Top > inner.Bottom - inner.Top)
          throw new InvalidOperationException("Action text does not fit at " + control.Dpi + " DPI: " + control.Text +
            " (font=" + family + ", points=" + points + ", weight=" + weight +
            ", text=" + (measured.Right - measured.Left) + "x" + (measured.Bottom - measured.Top) +
            ", allowance=" + allowance + ", client=" + (inner.Right - inner.Left) + "x" + (inner.Bottom - inner.Top) + ")");
      } finally {
        if (oldFont != IntPtr.Zero && oldFont != new IntPtr(-1)) SelectObject(dc, oldFont);
        if (dc != IntPtr.Zero) ReleaseDC(window, dc);
        DeleteObject(font);
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
