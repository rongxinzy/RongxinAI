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
    public static string PowerShellExecutablePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.System),
        "WindowsPowerShell", "v1.0", "powershell.exe");

    public static Task RunAsync(
        string file,
        string arguments,
        CancellationToken ct,
        Action<string>? onOutputLine = null,
        string? failureMessage = null)
        => RunAsync(new ProcessStartInfo { FileName = file, Arguments = arguments },
            ct, onOutputLine, failureMessage);

    public static Task RunPowerShellAsync(string script, string arguments,
        CancellationToken ct, string? failureMessage = null)
        => RunAsync(CreatePowerShellStartInfo(
            $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{script}\" {arguments}"),
            ct, failureMessage: failureMessage);

    public static ProcessStartInfo CreatePowerShellStartInfo(string arguments)
    {
        // A pwsh parent can export its incompatible PSModulePath. All bundled
        // scripts use Windows inbox modules (Utility, Management, Security and
        // CimCmdlets), so bind both the executable and module lookup to that
        // same trusted Windows PowerShell installation, in this child only.
        var home = Path.GetDirectoryName(PowerShellExecutablePath)!;
        var startInfo = new ProcessStartInfo
        {
            FileName = PowerShellExecutablePath,
            Arguments = arguments,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        startInfo.Environment["PSModulePath"] = Path.Combine(home, "Modules");
        return startInfo;
    }

    private static async Task RunAsync(ProcessStartInfo startInfo,
        CancellationToken ct, Action<string>? onOutputLine = null,
        string? failureMessage = null)
    {
        startInfo.RedirectStandardOutput = true;
        startInfo.RedirectStandardError = true;
        startInfo.UseShellExecute = false;
        startInfo.CreateNoWindow = true;
        startInfo.StandardOutputEncoding = System.Text.Encoding.UTF8;
        startInfo.StandardErrorEncoding = System.Text.Encoding.UTF8;
        using var process = new Process
        {
            StartInfo = startInfo,
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
