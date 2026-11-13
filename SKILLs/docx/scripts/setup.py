#!/usr/bin/env python3
"""minimax-docx Environment Setup & Initialization Script (cross-platform)."""

import argparse
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from datetime import datetime
from pathlib import Path


def log(msg: str) -> None:
    print(f"[OK]    {msg}")


def warn(msg: str) -> None:
    print(f"[WARN]  {msg}")


def fail(msg: str) -> None:
    print(f"[FAIL]  {msg}")


def info(msg: str) -> None:
    print(f"[INFO]  {msg}")


def step(msg: str) -> None:
    print(f"\n=== {msg} ===")


def detect_platform() -> tuple[str, str, str]:
    sys_name = platform.system()
    arch = platform.machine() or "unknown"

    if sys_name == "Darwin":
        return "macos", ("brew" if shutil.which("brew") else "none"), arch

    if sys_name == "Windows" or os.name == "nt":
        for mgr in ("winget", "choco", "scoop"):
            if shutil.which(mgr):
                return "windows", mgr, arch
        return "windows", "none", arch

    if sys_name == "Linux":
        os_kind = "linux"
        try:
            if "microsoft" in Path("/proc/version").read_text(encoding="utf-8", errors="ignore").lower():
                os_kind = "wsl"
        except OSError:
            pass

        pkg_mgr = "unknown"
        os_release = Path("/etc/os-release")
        if os_release.is_file():
            content = os_release.read_text(encoding="utf-8", errors="ignore")
            for line in content.splitlines():
                if line.startswith("ID="):
                    distro = line.split("=", 1)[1].strip().strip('"').lower()
                    if distro in ("ubuntu", "debian", "linuxmint", "pop"):
                        pkg_mgr = "apt"
                    elif distro in ("fedora", "rhel", "centos", "rocky", "alma"):
                        pkg_mgr = "dnf"
                    elif distro in ("arch", "manjaro", "endeavouros"):
                        pkg_mgr = "pacman"
                    elif distro.startswith("opensuse") or distro == "sles":
                        pkg_mgr = "zypper"
                    elif distro == "alpine":
                        pkg_mgr = "apk"
                    break
        if pkg_mgr == "unknown":
            for candidate in ("apt-get", "dnf", "pacman", "zypper", "apk"):
                if shutil.which(candidate):
                    pkg_mgr = "apt" if candidate == "apt-get" else candidate
                    break
        return os_kind, pkg_mgr, arch

    return "unknown", "unknown", arch


def run_cmd(cmd: list[str], log_file: Path | None = None) -> int:
    if log_file is not None:
        with log_file.open("a", encoding="utf-8", errors="replace") as f:
            return subprocess.run(cmd, stderr=f).returncode
    return subprocess.run(cmd).returncode


def dotnet_version() -> tuple[str | None, int]:
    dotnet = shutil.which("dotnet")
    if not dotnet:
        return None, 0
    try:
        ver = subprocess.check_output([dotnet, "--version"], text=True, stderr=subprocess.DEVNULL).strip()
        major = int(ver.split(".")[0]) if ver.split(".")[0].isdigit() else 0
        return ver, major
    except Exception:
        return None, 0


def install_dotnet(os_kind: str, pkg_mgr: str, log_file: Path) -> bool:
    step("Checking .NET SDK")
    ver, major = dotnet_version()
    if ver and major >= 8:
        log(f"dotnet {ver} already installed (>= 8.0 OK)")
        return True
    if ver:
        warn(f"dotnet {ver} found but < 8.0, upgrading...")

    info("Installing .NET SDK...")
    if pkg_mgr == "brew":
        run_cmd(["brew", "install", "--cask", "dotnet-sdk"])
    elif pkg_mgr == "winget":
        run_cmd(
            ["winget", "install", "Microsoft.DotNet.SDK.8", "--accept-source-agreements", "--accept-package-agreements"],
            log_file,
        )
    elif pkg_mgr == "choco":
        run_cmd(["choco", "install", "dotnet-sdk", "-y"], log_file)
    elif pkg_mgr == "scoop":
        run_cmd(["scoop", "install", "dotnet-sdk"], log_file)
    elif pkg_mgr == "dnf":
        run_cmd(["sudo", "dnf", "install", "-y", "dotnet-sdk-8.0"])
    elif pkg_mgr == "pacman":
        run_cmd(["sudo", "pacman", "-S", "--noconfirm", "dotnet-sdk"])
    elif pkg_mgr == "zypper":
        run_cmd(["sudo", "zypper", "install", "-y", "dotnet-sdk-8.0"])
    elif pkg_mgr == "apk":
        run_cmd(["apk", "add", "--no-cache", "dotnet8-sdk"])
    elif pkg_mgr in ("apt", "none") and os_kind != "windows":
        info("Using Microsoft install script...")
        tmp_script = Path(tempfile.gettempdir()) / "dotnet-install.sh"
        urllib.request.urlretrieve("https://dot.net/v1/dotnet-install.sh", tmp_script)
        os.chmod(tmp_script, 0o755)
        install_dir = Path.home() / ".dotnet"
        run_cmd(["/bin/sh", str(tmp_script), "--channel", "8.0", "--install-dir", str(install_dir)])
        os.environ["PATH"] = f"{install_dir}{os.pathsep}{os.environ.get('PATH', '')}"
    else:
        fail("Install .NET SDK manually: https://dotnet.microsoft.com/download")
        return False

    ver, major = dotnet_version()
    if ver and major >= 8:
        log(f"dotnet {ver} installed")
        return True
    fail("dotnet installation failed. Install manually: https://dotnet.microsoft.com/download")
    return False


def install_soffice(os_kind: str, pkg_mgr: str) -> None:
    step("Checking LibreOffice/soffice (optional: .doc conversion)")
    if shutil.which("soffice"):
        log("soffice already installed")
        return

    for candidate in (
        Path("/usr/bin/soffice"),
        Path("/usr/local/bin/soffice"),
        Path("/opt/libreoffice/program/soffice"),
        Path("/snap/bin/libreoffice"),
        Path("/Applications/LibreOffice.app/Contents/MacOS/soffice"),
        Path("C:/Program Files/LibreOffice/program/soffice.exe"),
        Path("C:/Program Files (x86)/LibreOffice/program/soffice.exe"),
    ):
        if candidate.is_file():
            log(f"soffice found at {candidate}")
            return

    info("Installing LibreOffice (this may take a while)...")
    if pkg_mgr == "brew":
        run_cmd(["brew", "install", "--cask", "libreoffice"])
    elif pkg_mgr == "winget":
        run_cmd(["winget", "install", "TheDocumentFoundation.LibreOffice", "--accept-source-agreements", "--accept-package-agreements"])
    elif pkg_mgr == "choco":
        run_cmd(["choco", "install", "libreoffice-fresh", "-y"])
    elif pkg_mgr == "apt":
        run_cmd(["sudo", "apt-get", "install", "-y", "-qq", "libreoffice-core"])
    elif pkg_mgr == "dnf":
        run_cmd(["sudo", "dnf", "install", "-y", "libreoffice-core"])
    elif pkg_mgr == "pacman":
        run_cmd(["sudo", "pacman", "-S", "--noconfirm", "libreoffice-still"])
    elif pkg_mgr == "zypper":
        run_cmd(["sudo", "zypper", "install", "-y", "libreoffice"])
    elif pkg_mgr == "apk":
        run_cmd(["apk", "add", "--no-cache", "libreoffice"])
    else:
        warn("Cannot auto-install LibreOffice. Install manually: https://www.libreoffice.org/download/")
        return

    if shutil.which("soffice"):
        log("soffice installed")
    else:
        warn("soffice not found after install (optional, .doc conversion unavailable)")


def check_fonts(os_kind: str) -> None:
    step("Checking fonts for document rendering")
    if os_kind == "macos":
        log("macOS: built-in CJK font support (PingFang, Hiragino, Apple SD Gothic)")
        if Path("/Applications/Microsoft Word.app").exists() or Path("/Applications/Microsoft Office").exists():
            log("Microsoft Office fonts available (Calibri, Cambria, etc.)")
        else:
            warn("Microsoft Office not installed — Calibri/Cambria fonts may be missing")
    elif os_kind == "windows":
        log("Windows: built-in CJK and Office/system font support")
    elif os_kind in ("linux", "wsl") and shutil.which("fc-list"):
        try:
            fonts = subprocess.check_output(["fc-list"], text=True, stderr=subprocess.DEVNULL).lower()
            if not any(k in fonts for k in ("liberation", "times new roman", "calibri")):
                warn("Missing Western fonts: install fonts-liberation / liberation-fonts")
            if not any(k in fonts for k in ("noto", "wqy", "simsun", "pingfang")):
                warn("Missing CJK fonts: install fonts-noto-cjk / noto-fonts-cjk")
        except Exception:
            pass


def check_nuget_config() -> None:
    step("Checking NuGet configuration")
    nuget_config = Path.home() / ".nuget" / "NuGet" / "NuGet.Config"
    if nuget_config.is_file():
        log(f"NuGet config exists: {nuget_config}")
    else:
        info("No custom NuGet config found (using defaults)")

    dotnet = shutil.which("dotnet")
    if not dotnet:
        return
    try:
        sources = subprocess.check_output([dotnet, "nuget", "list", "source"], text=True, stderr=subprocess.DEVNULL)
        if "nuget.org" in sources:
            log("nuget.org source is configured")
        else:
            warn("nuget.org not in sources. Adding...")
            subprocess.run(
                [dotnet, "nuget", "add", "source", "https://api.nuget.org/v3/index.json", "--name", "nuget.org"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
    except Exception:
        pass


def build_project(dotnet_dir: Path, log_file: Path) -> bool:
    step("Building minimax-docx .NET project")
    if not dotnet_dir.is_dir():
        fail(f"Dotnet project directory not found: {dotnet_dir}")
        return False

    dotnet = shutil.which("dotnet")
    if not dotnet:
        fail("dotnet CLI not found")
        return False

    info("Restoring NuGet packages...")
    with log_file.open("a", encoding="utf-8", errors="replace") as f:
        if subprocess.run([dotnet, "restore", "--verbosity", "quiet"], cwd=dotnet_dir, stderr=f).returncode != 0:
            fail(f"NuGet restore failed. Check network and {log_file} for details.")
            return False
    log("NuGet packages restored")

    info("Building project...")
    with log_file.open("a", encoding="utf-8", errors="replace") as f:
        if subprocess.run([dotnet, "build", "--verbosity", "quiet", "--no-restore"], cwd=dotnet_dir, stderr=f).returncode != 0:
            fail(f"Build failed. Check {log_file} for details.")
            return False
    log("Project built successfully")
    return True


def verify_installation(dotnet_dir: Path, log_file: Path) -> bool:
    step("Verification Test")
    dotnet = shutil.which("dotnet")
    if not dotnet:
        fail("dotnet CLI not found")
        return False

    tmp_docx = Path(tempfile.gettempdir()) / f"minimax-docx-setup-test-{os.getpid()}.docx"
    info("Creating a test document...")
    with log_file.open("a", encoding="utf-8", errors="replace") as f:
        rc = subprocess.run(
            [
                dotnet,
                "run",
                "--project",
                "MiniMaxAIDocx.Cli",
                "--",
                "create",
                "--type",
                "report",
                "--output",
                str(tmp_docx),
                "--title",
                "Setup Test",
            ],
            cwd=dotnet_dir,
            stderr=f,
        ).returncode
    if rc == 0 and tmp_docx.is_file():
        log(f"Test document created: {tmp_docx}")
        tmp_docx.unlink(missing_ok=True)
        log("Test passed — minimax-docx is ready to use!")
        return True

    fail(f"Test document creation failed. Check {log_file} for details.")
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="minimax-docx Environment Setup & Initialization")
    parser.add_argument("--minimal", action="store_true", help="Only install critical dependencies (skip soffice and fonts)")
    parser.add_argument("--skip-verify", action="store_true", help="Skip the verification test at the end")
    args = parser.parse_args()

    os.environ["DOTNET_CLI_UI_LANGUAGE"] = "en"
    script_dir = Path(__file__).resolve().parent
    project_dir = script_dir.parent
    dotnet_dir = script_dir / "dotnet"
    log_file = project_dir / ".setup.log"

    print("============================================")
    print("  minimax-docx Setup & Initialization")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("============================================")

    log_file.write_text("", encoding="utf-8")

    os_kind, pkg_mgr, arch = detect_platform()
    print(f"Platform: {os_kind} ({arch}), Package Manager: {pkg_mgr}")

    if not install_dotnet(os_kind, pkg_mgr, log_file):
        return 1

    if not args.minimal:
        install_soffice(os_kind, pkg_mgr)
        check_fonts(os_kind)

    check_nuget_config()
    if not build_project(dotnet_dir, log_file):
        return 1

    if not args.skip_verify:
        if not verify_installation(dotnet_dir, log_file):
            return 1

    ver, _ = dotnet_version()
    step("Setup Complete")
    print("")
    print(f"  Environment: {os_kind} ({arch})")
    print(f"  .NET SDK:    {ver or 'NOT FOUND'}")
    print(f"  Project:     {dotnet_dir}")
    print("")
    print("  Usage:")
    print(f"    python3 {script_dir / 'cli.py'} create --type report --output my_report.docx")
    print(f"    python3 {script_dir / 'env_check.py'}     # Quick environment check")
    print("")
    print(f"  Log file: {log_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
