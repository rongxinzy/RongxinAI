using System;
using System.IO;
using System.Text;

namespace ZhiYuan.Acceptance {
  public static class DiagnosticTrace {
    private static readonly object Gate = new object();
    private static StreamWriter writer;
    private static int childOrdinal;

    public static void Initialize(string jsonlPath) {
      lock (Gate) {
        writer?.Dispose();
        writer = new StreamWriter(jsonlPath, false, Encoding.UTF8) { AutoFlush = true };
        childOrdinal = 0;
      }
    }

    public static void Close() {
      lock (Gate) {
        writer?.Dispose();
        writer = null;
      }
    }

    private static string JsonEscape(string value) {
      if (value == null) return "\"\"";
      return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n") + "\"";
    }

    public static void Event(string kind, long hwnd, string context, int? lastError, int? childIndex = null, int? ownerPid = null, string exception = null) {
      lock (Gate) {
        if (writer == null) return;
        var line = new StringBuilder();
        line.Append("{\"utc\":").Append(JsonEscape(DateTime.UtcNow.ToString("o")));
        line.Append(",\"kind\":").Append(JsonEscape(kind));
        line.Append(",\"hwnd\":").Append(hwnd);
        line.Append(",\"context\":").Append(JsonEscape(context ?? ""));
        if (lastError.HasValue) line.Append(",\"lastError\":").Append(lastError.Value);
        if (childIndex.HasValue) line.Append(",\"childIndex\":").Append(childIndex.Value);
        if (ownerPid.HasValue) line.Append(",\"ownerPid\":").Append(ownerPid.Value);
        if (exception != null) line.Append(",\"exception\":").Append(JsonEscape(exception));
        line.Append("}");
        writer.WriteLine(line.ToString());
      }
    }

    public static int NextChildIndex() {
      return System.Threading.Interlocked.Increment(ref childOrdinal);
    }
  }
}
