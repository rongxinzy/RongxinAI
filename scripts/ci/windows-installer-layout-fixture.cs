// A separate real Win32 process for font/layout acceptance regression.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class LayoutFixture {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern IntPtr CreateWindowEx(int extended, string className, string text, uint style,
    int x, int y, int width, int height, IntPtr parent, IntPtr id, IntPtr instance, IntPtr parameter);
  [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("gdi32.dll", CharSet = CharSet.Unicode, EntryPoint = "CreateFontW")]
  private static extern IntPtr CreateFont(int height, int width, int escapement, int orientation,
    int weight, uint italic, uint underline, uint strikeout, uint charset,
    uint outputPrecision, uint clipPrecision, uint quality, uint pitch, string family);
  [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr value);

  [STAThread]
  private static void Main(string[] args) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    Application.EnableVisualStyles();
    var fonts = new List<IntPtr>();
    using (var form = new Form()) {
      form.Text = "ZhiYuan cross-process layout fixture";
      form.AutoScaleMode = AutoScaleMode.None;
      form.ClientSize = new Size(480, 500);
      var parent = form.Handle;
      var dpi = GetDpiForWindow(parent);
      Func<int, int> scale = value => (int)Math.Round(value * dpi / 96.0);
      var family = args[0];
      var points = int.Parse(args[1]);
      var bodyWeight = int.Parse(args[2]);
      var buttonWeight = int.Parse(args[3]);
      Action<int, string, int, int, int, int, uint> add = (id, text, width, height, size, weight, style) => {
        var control = CreateWindowEx(0, "Button", text, 0x54010000 | style,
          scale(20), scale(10 + (id - 101) * 38), scale(width), scale(height), parent, new IntPtr(id), IntPtr.Zero, IntPtr.Zero);
        if (control == IntPtr.Zero) throw new InvalidOperationException("Fixture control creation failed");
        var font = CreateFont(-(int)Math.Round(size * dpi / 72.0), 0, 0, 0, weight, 0, 0, 0, 1, 0, 0, 0, 0, family);
        if (font == IntPtr.Zero) throw new InvalidOperationException("Fixture font creation failed");
        fonts.Add(font);
        SendMessage(control, 0x0030, font, new IntPtr(1));
      };
      // NSD_CreateCheckbox: BS_AUTOCHECKBOX | BS_VCENTER | BS_MULTILINE.
      const uint checkbox = 0x2c03;
      var chinese = "\u5df2\u9605\u8bfb\u5e76\u540c\u610f";
      add(101, chinese, 105, 15, points, bodyWeight, checkbox);
      add(102, chinese, 30, 15, points, bodyWeight, checkbox);
      add(103, chinese, 105, 5, points, bodyWeight, checkbox);
      add(104, "I agree to the", 105, 16, points, bodyWeight, checkbox);
      add(105, "I agree to the", 45, 16, points, bodyWeight, checkbox);
      add(106, chinese, 260, 40, points * 2, bodyWeight, checkbox);
      add(107, chinese, 105, 40, points * 2, bodyWeight, checkbox);
      add(108, "\u5b89\u88c5", 78, 20, points, buttonWeight, 0);
      add(109, "Install", 78, 20, points, buttonWeight, 0);
      add(110, "Install", 20, 20, points, buttonWeight, 0);
      using (var timeout = new Timer()) {
        timeout.Interval = 30000;
        timeout.Tick += (sender, value) => form.Close();
        timeout.Start();
        Application.Run(form);
      }
    }
    foreach (var font in fonts) DeleteObject(font);
  }
}
