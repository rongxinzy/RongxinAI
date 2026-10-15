namespace ZhiYuan.Setup.Shell;

internal static class SetupArguments
{
    public static bool IsSilent(string[] args) => args.Any(value =>
        value.Equals("--silent", StringComparison.OrdinalIgnoreCase) ||
        value.Equals("/S", StringComparison.OrdinalIgnoreCase));

    public static string EventsLogPath(string[] args) =>
        SetupForm.ValueAfter(args, "--events-log") is string explicitPath
            ? Path.GetFullPath(explicitPath)
            : Path.Combine(Path.GetTempPath(), "zy-setup-events.jsonl");

    public static string? InstallDirectory(string[] args) =>
        SetupForm.ValueAfter(args, "--install-dir") ??
        args.FirstOrDefault(value => value.StartsWith("/D=", StringComparison.OrdinalIgnoreCase))?[3..] ??
        args.FirstOrDefault(value => value.StartsWith("_?=", StringComparison.Ordinal))?[3..];

    public static int? AcceptanceDebugPort(string[] args)
    {
        var value = SetupForm.ValueAfter(args, "--acceptance-debug-port");
        if (value is null) return null;
        if (!int.TryParse(value, out var port) || port < 1024 || port > 65535)
            throw new ArgumentException("--acceptance-debug-port requires a port between 1024 and 65535");
        return port;
    }
}
