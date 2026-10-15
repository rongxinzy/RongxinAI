using System.Diagnostics;

namespace ZhiYuan.Setup.Shell;

/// <summary>
/// Child-process runner shared by the install and uninstall engines.
/// Cancellation propagates as a full process-tree kill; 7za refreshes progress
/// on carriage returns, so stdout is pumped manually and split on both \r and
/// \n to surface percentage lines the line-based API would never deliver.
/// </summary>
internal static class ShellProcessRunner
{
    public static async Task RunAsync(
        string file,
        string arguments,
        CancellationToken ct,
        Action<string>? onOutputLine = null,
        string? failureMessage = null)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = file,
                Arguments = arguments,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = System.Text.Encoding.UTF8,
                StandardErrorEncoding = System.Text.Encoding.UTF8,
            },
        };
        var output = new System.Text.StringBuilder();
        void Append(string? line)
        {
            if (line is null) return;
            lock (output)
            {
                output.AppendLine(line);
                if (output.Length > 32 * 1024) output.Remove(0, output.Length - 32 * 1024);
            }
        }
        process.Start();
        var stdoutPump = Task.Run(async () =>
        {
            var pending = new System.Text.StringBuilder();
            var buffer = new char[2048];
            int read;
            while ((read = await process.StandardOutput.ReadAsync(buffer, 0, buffer.Length)) > 0)
            {
                for (var i = 0; i < read; i++)
                {
                    var ch = buffer[i];
                    if (ch is '\r' or '\n')
                    {
                        var line = pending.ToString();
                        pending.Clear();
                        if (line.Length > 0) { Append(line); onOutputLine?.Invoke(line); }
                    }
                    else
                    {
                        pending.Append(ch);
                        if (pending.Length > 32 * 1024) pending.Remove(0, pending.Length - 32 * 1024);
                    }
                }
            }
            if (pending.Length > 0) { Append(pending.ToString()); onOutputLine?.Invoke(pending.ToString()); }
        });
        var stderrPump = Task.Run(async () =>
        {
            var buffer = new char[2048];
            int read;
            while ((read = await process.StandardError.ReadAsync(buffer, 0, buffer.Length)) > 0)
                Append(new string(buffer, 0, read));
        });
        try
        {
            await process.WaitForExitAsync(ct);
            await Task.WhenAll(stdoutPump, stderrPump);
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch { }
            try { await process.WaitForExitAsync(CancellationToken.None); } catch { }
            try { await Task.WhenAll(stdoutPump, stderrPump); } catch { }
            throw;
        }
        var code = process.ExitCode;
        if (failureMessage is not null && code != 0)
        {
            throw new EngineException($"{failureMessage}（退出码 {code}）", TrimOutput(output.ToString()));
        }
    }

    public static string TrimOutput(string text)
    {
        var flat = text.Replace("\r", " ").Replace("\n", " ").Trim();
        return flat.Length <= 400 ? flat : flat[..400];
    }
}
