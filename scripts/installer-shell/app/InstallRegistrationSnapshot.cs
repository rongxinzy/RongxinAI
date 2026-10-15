using Microsoft.Win32;

namespace ZhiYuan.Setup.Shell;

/// <summary>Registration is the last fallible install step. Restore previous
/// values and shortcut bytes if it fails, rather than orphaning a restored app.</summary>
internal sealed class InstallRegistrationSnapshot
{
    private sealed record Value(string Name, object Data, RegistryValueKind Kind);
    private readonly Dictionary<string, List<Value>?> keys = new();
    private readonly Dictionary<string, byte[]?> shortcuts = new();

    public InstallRegistrationSnapshot()
    {
        foreach (var path in new[] { InstallerEngine.InstallRegistryKey, InstallerEngine.UninstallRegistryKey })
        {
            using var key = Registry.CurrentUser.OpenSubKey(path);
            keys[path] = key?.GetValueNames().Select(name =>
                new Value(name, key.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames)!, key.GetValueKind(name))).ToList();
        }
        foreach (var folder in new[] { Environment.SpecialFolder.Programs, Environment.SpecialFolder.DesktopDirectory })
        {
            var path = Path.Combine(Environment.GetFolderPath(folder), InstallerEngine.DisplayName + ".lnk");
            shortcuts[path] = File.Exists(path) ? File.ReadAllBytes(path) : null;
        }
    }

    public void Restore()
    {
        foreach (var (path, values) in keys)
        {
            if (values is null)
            {
                Registry.CurrentUser.DeleteSubKeyTree(path, throwOnMissingSubKey: false);
                continue;
            }
            using var key = Registry.CurrentUser.CreateSubKey(path);
            foreach (var name in key.GetValueNames()) key.DeleteValue(name);
            foreach (var value in values) key.SetValue(value.Name, value.Data, value.Kind);
        }
        foreach (var (path, bytes) in shortcuts)
        {
            if (bytes is null) File.Delete(path);
            else File.WriteAllBytes(path, bytes);
        }
    }
}
