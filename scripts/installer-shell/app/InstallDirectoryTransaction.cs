using System.Text.Json;

namespace ZhiYuan.Setup.Shell;

/// <summary>Owns only the application directory. A durable sibling journal
/// makes a killed upgrade recoverable without reading or deleting user data.</summary>
internal sealed class InstallDirectoryTransaction
{
    private readonly string installDir;
    private readonly string journalPath;
    private TransactionState? state;

    internal sealed record TransactionState(string InstallDir, string? BackupDir, bool Committed);

    public InstallDirectoryTransaction(string installDir)
    {
        this.installDir = Path.TrimEndingDirectorySeparator(Path.GetFullPath(installDir));
        journalPath = this.installDir + ".setup-state.json";
    }

    public bool HasPendingState => File.Exists(journalPath);
    public bool IsCommitted => ReadState()?.Committed == true;
    public string? BackupDir => state?.BackupDir;

    public void ValidateOwnership()
    {
        // Reading a journal validates its directory binding without mutation.
        // It also permits an interrupted partial extraction to be recovered.
        if (ReadState() is not null) return;
        if (Directory.Exists(installDir) && Directory.EnumerateFileSystemEntries(installDir).Any() &&
            (!File.Exists(Path.Combine(installDir, InstallerEngine.AppExeName)) ||
             !File.Exists(Path.Combine(installDir, "resources", "app.asar"))))
            throw new EngineException("所选目录包含其他文件，请选择空目录或已有的知远安装目录。");
    }

    public void Begin()
    {
        if (HasPendingState) throw new EngineException("上次安装尚未恢复，请重试安装。");
        ValidateOwnership();
        var exists = Directory.Exists(installDir);
        var backup = exists ? installDir + ".old." + Guid.NewGuid().ToString("n") : null;
        state = new TransactionState(installDir, backup, false);
        WriteState(); // Persist before the rename so a crash never loses the old tree.
        if (backup is not null) Directory.Move(installDir, backup);
    }

    public void MarkCommitted()
    {
        state = (state ?? throw new InvalidOperationException("No install transaction")) with { Committed = true };
        WriteState();
    }

    public void Finish()
    {
        File.Delete(journalPath);
        state = null;
    }

    public void Rollback(bool preserveJournal = false)
    {
        var pending = ReadState();
        if (pending is null || pending.Committed) return;
        if (pending.BackupDir is null)
        {
            DeleteTreeWithoutFollowingLinks(installDir);
        }
        else if (Directory.Exists(pending.BackupDir))
        {
            // Extraction creates a new directory at the original path. Remove
            // that partial tree before moving the previous installation back.
            DeleteTreeWithoutFollowingLinks(installDir);
            Directory.Move(pending.BackupDir, installDir);
        }
        // With no backup, the rename never happened: leave the original alone.
        if (!preserveJournal) Finish();
    }

    private TransactionState? ReadState()
    {
        if (state is not null) return state;
        if (!File.Exists(journalPath)) return null;
        if ((File.GetAttributes(journalPath) & FileAttributes.ReparsePoint) != 0)
            throw new EngineException("安装恢复记录不能是文件链接。");
        var pending = JsonSerializer.Deserialize<TransactionState>(File.ReadAllText(journalPath))
            ?? throw new EngineException("安装恢复记录损坏，请保留现有文件并重新运行安装程序。");
        var expectedPrefix = installDir + ".old.";
        if (!string.Equals(pending.InstallDir, installDir, StringComparison.OrdinalIgnoreCase) ||
            (pending.BackupDir is not null &&
             (!pending.BackupDir.StartsWith(expectedPrefix, StringComparison.OrdinalIgnoreCase) ||
              !Guid.TryParseExact(pending.BackupDir[expectedPrefix.Length..], "n", out _))))
            throw new EngineException("安装恢复记录不属于所选目录，未修改任何安装文件。");
        state = pending;
        return state;
    }

    private void WriteState()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(journalPath)!);
        var temporary = journalPath + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(state));
        File.Move(temporary, journalPath, overwrite: true);
    }

    internal static void ValidateRoots(string installDir, string runtimeRoot, string appDataRoot)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(installDir));
        if (string.Equals(full, Path.GetPathRoot(full), StringComparison.OrdinalIgnoreCase) ||
            full.StartsWith(@"\\", StringComparison.Ordinal) ||
            full.Contains('"') || full.Contains('\r') || full.Contains('\n'))
            throw new EngineException("请选择本机的独立应用安装目录。");
        foreach (var protectedRoot in new[] { appDataRoot, runtimeRoot })
        {
            if (ContainsPath(full, protectedRoot) || ContainsPath(protectedRoot, full))
                throw new EngineException("安装目录不能与个人数据或运行环境目录重叠。");
        }
        foreach (var checkedRoot in new[] { full, runtimeRoot, appDataRoot })
        {
        if (Path.GetFullPath(checkedRoot).TrimEnd(Path.DirectorySeparatorChar) == Path.GetPathRoot(checkedRoot)?.TrimEnd(Path.DirectorySeparatorChar))
            throw new EngineException("安装与数据目录不能是磁盘根目录。");
        foreach (var folder in new[] { Environment.SpecialFolder.UserProfile,
            Environment.SpecialFolder.DesktopDirectory, Environment.SpecialFolder.MyDocuments,
            Environment.SpecialFolder.ApplicationData, Environment.SpecialFolder.LocalApplicationData,
            Environment.SpecialFolder.Windows, Environment.SpecialFolder.ProgramFiles,
            Environment.SpecialFolder.ProgramFilesX86 })
        {
            var protectedRoot = Environment.GetFolderPath(folder);
            if (!string.IsNullOrEmpty(protectedRoot) && ContainsPath(checkedRoot, protectedRoot))
                throw new EngineException("请选择独立的应用文件夹，不要选择系统或个人文件根目录。");
        }
        }
        foreach (var root in new[] { full, runtimeRoot, appDataRoot })
        for (var dir = new DirectoryInfo(root); dir is not null; dir = dir.Parent)
        {
            if (dir.Exists && (dir.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new EngineException("安装目录不能通过目录链接指向其他位置。");
        }
    }

    private static bool ContainsPath(string parent, string child)
    {
        var normalized = Path.TrimEndingDirectorySeparator(Path.GetFullPath(parent));
        var candidate = Path.TrimEndingDirectorySeparator(Path.GetFullPath(child));
        return candidate.Equals(normalized, StringComparison.OrdinalIgnoreCase) ||
            candidate.StartsWith(normalized + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
    }

    internal static void DeleteTreeWithoutFollowingLinks(string root)
    {
        if (!Directory.Exists(root)) return;
        if ((File.GetAttributes(root) & FileAttributes.ReparsePoint) != 0)
        {
            Directory.Delete(root);
            return;
        }
        foreach (var file in Directory.EnumerateFiles(root)) File.Delete(file);
        foreach (var child in Directory.EnumerateDirectories(root)) DeleteTreeWithoutFollowingLinks(child);
        Directory.Delete(root);
    }
}
