#!/usr/bin/env python3
"""minimax-docx quick environment check (macOS, Linux, WSL, Windows)."""

import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path


def detect_os() -> str:
    sys_name = platform.system()
    if sys_name == "Darwin":
        return "macos"
    if sys_name == "Linux":
        try:
            if "microsoft" in Path("/proc/version").read_text(encoding="utf-8", errors="ignore").lower():
                return "wsl"
        except OSError:
            pass
        return "linux"
    if sys_name == "Windows" or os.name == "nt":
        return "windows"
    return "unknown"


def is_executable_file(path: Path) -> bool:
    if not path.is_file():
        return False
    if os.name == "nt":
        return True
    return os.access(path, os.X_OK)


def find_soffice() -> tuple[str | None, str | None]:
    cmd = shutil.which("soffice")
    if cmd:
        try:
            out = subprocess.check_output([cmd, "--version"], text=True, stderr=subprocess.DEVNULL)
            match = re.search(r"\d+\.\d+(?:\.\d+)?", out)
            return cmd, (match.group(0) if match else "?")
        except Exception:
            return cmd, "?"

    for candidate in (
        Path("/Applications/LibreOffice.app/Contents/MacOS/soffice"),
        Path("/usr/lib/libreoffice/program/soffice"),
        Path("/snap/bin/libreoffice"),
        Path("/opt/libreoffice/program/soffice"),
        Path("C:/Program Files/LibreOffice/program/soffice.exe"),
        Path("C:/Program Files (x86)/LibreOffice/program/soffice.exe"),
    ):
        if is_executable_file(candidate):
            return str(candidate), None
    return None, None


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    project_dir = script_dir.parent
    dotnet_dir = script_dir / "dotnet"

    os.environ["DOTNET_CLI_UI_LANGUAGE"] = "en"

    print("=== minimax-docx Environment Check ===")
    print("")

    status = "READY"
    warnings = 0
    dotnet_available = True
    os_kind = detect_os()

    # --- Full pipeline: bundled self-contained CLI, then .NET SDK ---
    bundled_candidates = [
        project_dir / "runtime" / "MiniMaxAIDocx.Cli.exe",
        project_dir / "runtime" / "MiniMaxAIDocx.exe",
        project_dir / "runtime" / "MiniMaxAIDocx.Cli",
        project_dir / "runtime" / "MiniMaxAIDocx",
    ]
    runtime_available = any(is_executable_file(c) for c in bundled_candidates)
    if runtime_available:
        print(f"[OK]      {'docx cli':<14} bundled self-contained runtime")

    dotnet_cmd = shutil.which("dotnet")
    if runtime_available:
        print(f"[SKIP]    {'dotnet':<14} not required with the bundled runtime")
    elif not dotnet_cmd:
        print(
            f"[WARN]    {'dotnet':<14} not found (bundled Markdown fallback can still create simple DOCX files)"
        )
        print("")
        print("  .NET SDK is REQUIRED. Install it:")
        if os_kind == "macos":
            print("    brew install --cask dotnet-sdk")
        elif os_kind in ("linux", "wsl"):
            print("    # Option 1: Microsoft install script")
            print("    wget https://dot.net/v1/dotnet-install.sh -O /tmp/dotnet-install.sh")
            print("    chmod +x /tmp/dotnet-install.sh && /tmp/dotnet-install.sh --channel 8.0")
            print("    # Option 2 (Ubuntu/Debian): sudo apt-get install -y dotnet-sdk-8.0")
        elif os_kind == "windows":
            print("    winget install Microsoft.DotNet.SDK.8")
        else:
            print("    https://dotnet.microsoft.com/download")
        print("")
        print("  Or run the full setup: python scripts/setup.py")
        print("")
        dotnet_available = False
        status = "LIMITED"
    else:
        try:
            ver = subprocess.check_output(
                [dotnet_cmd, "--version"], text=True, stderr=subprocess.DEVNULL
            ).strip()
        except Exception:
            ver = "0.0.0"
        major = int(ver.split(".")[0]) if ver.split(".")[0].isdigit() else 0
        if major >= 8:
            print(f"[OK]      {'dotnet':<14} {ver} (>= 8.0)")
        else:
            print(f"[FAIL]    {'dotnet':<14} {ver} (requires >= 8.0)")
            dotnet_available = False
            status = "LIMITED"

    # --- Critical: NuGet packages ---
    if runtime_available:
        print(f"[SKIP]    {'OpenXML project':<14} not needed with the bundled runtime")
    elif dotnet_dir.is_dir():
        built_net10 = dotnet_dir / "MiniMaxAIDocx.Cli" / "bin" / "Debug" / "net10.0" / "MiniMaxAIDocx.Cli.dll"
        built_net8 = dotnet_dir / "MiniMaxAIDocx.Cli" / "bin" / "Debug" / "net8.0" / "MiniMaxAIDocx.Cli.dll"
        if not dotnet_available:
            print(
                f"[SKIP]    {'OpenXML project':<14} requires .NET 8+ (bundled Markdown fallback remains available)"
            )
        elif built_net10.is_file() or built_net8.is_file():
            print(f"[OK]      {'project':<14} built")
        else:
            assert dotnet_cmd is not None
            restore = subprocess.run(
                [dotnet_cmd, "restore", str(dotnet_dir), "--verbosity", "quiet"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if restore.returncode == 0:
                print(f"[OK]      {'nuget':<14} packages restored")
                build = subprocess.run(
                    [dotnet_cmd, "build", str(dotnet_dir), "--verbosity", "quiet", "--no-restore"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                if build.returncode == 0:
                    print(f"[OK]      {'project':<14} build succeeded")
                else:
                    print(f"[FAIL]    {'project':<14} build failed (run: dotnet build {dotnet_dir})")
                    status = "NOT READY"
            else:
                print(f"[FAIL]    {'nuget':<14} restore failed")
                print("")
                print("  Common causes:")
                print("    - No internet access (NuGet needs to download packages)")
                print("    - Corporate proxy blocking nuget.org")
                print("    - SSL certificate issues (try: dotnet nuget list source)")
                print("")
                status = "NOT READY"
    else:
        print(f"[FAIL]    {'project':<14} directory not found: {dotnet_dir}")
        status = "NOT READY"

    # --- Optional: LibreOffice ---
    soffice_path, soffice_ver = find_soffice()
    if soffice_path and soffice_ver is not None:
        print(f"[OK]      {'soffice':<14} {soffice_ver} (.doc conversion)")
    elif soffice_path:
        print(f"[OK]      {'soffice':<14} found at {soffice_path} (.doc conversion)")
    else:
        print(f"[WARN]    {'soffice':<14} not found — .doc files cannot be converted")
        warnings += 1
        if os_kind == "macos":
            print("           Install: brew install --cask libreoffice")
        elif os_kind in ("linux", "wsl"):
            print("           Install: sudo apt-get install libreoffice-core")
        elif os_kind == "windows":
            print("           Install: winget install TheDocumentFoundation.LibreOffice")

    # --- Optional: zip/unzip ---
    print(f"[OK]      {'zip/unzip':<14} Python zipfile built-in available")

    # --- Encoding check ---
    lang = os.environ.get("LANG", "")
    if os.environ.get("PYTHONUTF8") == "1" or "utf-8" in lang.lower() or "utf8" in lang.lower():
        label = f"LANG={lang}" if lang else "PYTHONUTF8=1"
        print(f"[OK]      {'locale':<14} {label}")
    else:
        if not lang:
            print(f"[WARN]    {'locale':<14} LANG not set (CJK text may have issues)")
        else:
            print(f"[WARN]    {'locale':<14} {lang} (not UTF-8, CJK text may have issues)")
        warnings += 1
        if os_kind == "windows":
            print("           Fix: set PYTHONUTF8=1")
        else:
            print("           Fix: export LANG=en_US.UTF-8")

    # --- Result ---
    print("")
    if status == "READY":
        if warnings > 0:
            print(f"Status: READY (with {warnings} warning(s) — optional features may be limited)")
        else:
            print("Status: READY")
        return 0
    if status == "LIMITED":
        print(
            "Status: LIMITED (bundled Markdown fallback is available for simple document creation; OpenXML editing/template operations require .NET 8+)"
        )
        return 0

    print("Status: NOT READY")
    print("")
    print("Critical dependencies missing. Run the full setup:")
    print("  python3 scripts/setup.py       # macOS / Linux / WSL / Windows")
    print("  powershell scripts/setup.ps1   # Windows PowerShell")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
