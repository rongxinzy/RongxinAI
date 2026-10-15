// A real child process with the same control-ID scopes as the NSIS pages.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class ProgressFixture {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern IntPtr CreateWindowEx(int extended, string className, string text, uint style,
    int x, int y, int width, int height, IntPtr parent, IntPtr id, IntPtr instance, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern bool SetWindowText(IntPtr window, string text);

  private sealed class FixtureForm : Form {
    public IntPtr AdvanceButton;
    public Action Advance;

    protected override void WndProc(ref Message message) {
      // The real native Button sends WM_COMMAND / BN_CLICKED to its parent.
      if (message.Msg == 0x0111 && message.LParam == AdvanceButton &&
          AdvanceButton != IntPtr.Zero && ((message.WParam.ToInt64() >> 16) & 0xffff) == 0) {
        Advance();
        return;
      }
      base.WndProc(ref message);
    }
  }

  private static IntPtr Add(IntPtr parent, int id, string className, string text) {
    var result = CreateWindowEx(0, className, text, 0x50000000,
      10, 10 + (id - 1200) * 20, 300, 20, parent, new IntPtr(id), IntPtr.Zero, IntPtr.Zero);
    if (result == IntPtr.Zero) throw new InvalidOperationException("Fixture control creation failed");
    return result;
  }

  [STAThread]
  private static void Main(string[] args) {
    var mode = args[0];
    Application.EnableVisualStyles();
    using (var form = new FixtureForm()) {
      form.Text = "ZhiYuan progress ownership fixture";
      form.ClientSize = new Size(450, 350);
      var wizard = form.Handle;
      var page = CreateWindowEx(0, "Static", "", 0x50000000, 0, 0, 400, 220,
        wizard, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
      if (page == IntPtr.Zero) throw new InvalidOperationException("Fixture page creation failed");
      // Hero child controls reuse exactly the raw progress ID range.
      for (int id = 1200; id <= 1206; id++)
        Add(page, id, "Static", id == 1201 ? "ZhiYuan Agent" : "Hero content");
      var progress = new List<IntPtr>();
      int stage = 0;
      // WinForms Button uses WindowsForms10.BUTTON..., whereas the production
      // driver deliberately accepts only the native Button class used by NSIS.
      var advance = CreateWindowEx(0, "Button", "Advance fixture", 0x50010000,
        10, 280, 150, 23, wizard, new IntPtr(1100), IntPtr.Zero, IntPtr.Zero);
      if (advance == IntPtr.Zero) throw new InvalidOperationException("Fixture advance creation failed");
      form.AdvanceButton = advance;
      form.Advance = () => {
        if (stage == 0) {
          if (!DestroyWindow(page)) throw new InvalidOperationException("Fixture hero destruction failed");
          page = IntPtr.Zero;
          for (int id = 1200; id <= (mode == "incomplete" ? 1205 : 1206); id++) {
            var text = id == 1201 ? (mode == "wrong-title" ? "ZhiYuan Agent" : "Installing ZhiYuan Agent") : "";
            var control = Add(wizard, id, "Static", text);
            progress.Add(control);
            if (id == 1206) ShowWindow(control, 0); // completed bar starts hidden
          }
          stage = 1;
          if (!SetWindowText(advance, "Finish fixture")) throw new InvalidOperationException("Fixture progress acknowledgement failed");
        } else if (stage == 1) {
          for (int index = 0; index < progress.Count; index++) {
            if (index == 1 && (mode == "visible-residue" || mode == "hidden-residue")) {
              if (mode == "hidden-residue") ShowWindow(progress[index], 0);
            } else if (!DestroyWindow(progress[index])) {
              throw new InvalidOperationException("Fixture progress destruction failed");
            }
          }
          page = CreateWindowEx(0, "Static", "", 0x50000000, 0, 0, 400, 220,
            wizard, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
          if (page == IntPtr.Zero) throw new InvalidOperationException("Fixture finish creation failed");
          Add(page, 1200, "Static", "Success glyph");
          Add(page, 1201, "Button", "Launch ZhiYuan Agent");
          Add(page, 1202, "Button", "Finish");
          Add(page, 1203, "Static", "Finish background");
          stage = 2;
          if (!SetWindowText(advance, "Fixture finished")) throw new InvalidOperationException("Fixture finish acknowledgement failed");
        }
      };
      using (var timeout = new Timer()) {
        timeout.Interval = 30000;
        timeout.Tick += (sender, value) => form.Close();
        timeout.Start();
        Application.Run(form);
      }
    }
  }
}
