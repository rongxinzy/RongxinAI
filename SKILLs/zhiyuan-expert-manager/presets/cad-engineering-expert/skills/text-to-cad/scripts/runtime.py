from __future__ import annotations

import hashlib
import os
import platform
import shutil
import tarfile
import tempfile
from pathlib import Path, PurePosixPath

VERSION = "0.4.28"
COMMIT = "0e94cd1d2b5fa2013d89aa9504ecadcf16ce39f6"
ARCHIVE_SHA256 = "db236fa8f34bfd01f01d1bc033732e8a451abb6c730f306d8758f98890c79252"
SKILL_NAMES = (
    "cad",
    "cad-viewer",
    "step-parts",
    "dxf",
    "urdf",
    "srdf",
    "sdf",
    "sendcutsend",
    "dfam-check",
    "gcode",
    "bambu-labs",
    "implicit-cad",
)

SKILL_ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_PATH = SKILL_ROOT / "vendor" / f"text-to-cad-{VERSION}.tar.gz"
MARKER_NAME = ".zhiyuan-runtime-sha256"


def default_cache_root() -> Path:
    override = os.environ.get("ZHIYUAN_TEXT_TO_CAD_CACHE", "").strip()
    if override:
        return Path(override).expanduser().resolve()

    system = platform.system().lower()
    if system == "windows":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
        return base / "ZhiYuanAgent" / "Cache" / "text-to-cad"
    if system == "darwin":
        return Path.home() / "Library" / "Caches" / "ZhiYuanAgent" / "text-to-cad"
    base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "ZhiYuanAgent" / "text-to-cad"


def archive_digest() -> str:
    digest = hashlib.sha256()
    with ARCHIVE_PATH.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_archive() -> None:
    if not ARCHIVE_PATH.is_file():
        raise RuntimeError(f"Bundled text-to-cad archive is missing: {ARCHIVE_PATH}")
    actual = archive_digest()
    if actual != ARCHIVE_SHA256:
        raise RuntimeError(
            "Bundled text-to-cad archive checksum mismatch: "
            f"expected {ARCHIVE_SHA256}, received {actual}"
        )


def _validated_members(archive: tarfile.TarFile) -> list[tarfile.TarInfo]:
    members = archive.getmembers()
    for member in members:
        relative = PurePosixPath(member.name)
        if relative.is_absolute() or ".." in relative.parts:
            raise RuntimeError(f"Unsafe path in text-to-cad archive: {member.name}")
        if not (member.isdir() or member.isfile()):
            raise RuntimeError(f"Unsupported entry in text-to-cad archive: {member.name}")
    return members


def _extract(destination: Path) -> None:
    with tarfile.open(ARCHIVE_PATH, "r:gz") as archive:
        members = _validated_members(archive)
        for member in members:
            archive.extract(member, destination, set_attrs=True, numeric_owner=False)


def _validate_runtime(root: Path) -> None:
    marker = root / MARKER_NAME
    if not marker.is_file() or marker.read_text(encoding="utf-8").strip() != ARCHIVE_SHA256:
        raise RuntimeError(f"Invalid text-to-cad runtime marker: {root}")
    for name in SKILL_NAMES:
        if not (root / "skills" / name / "SKILL.md").is_file():
            raise RuntimeError(f"Incomplete text-to-cad runtime, missing workflow: {name}")


def ensure_runtime(cache_root: Path | None = None) -> Path:
    verify_archive()
    parent = (cache_root or default_cache_root()).expanduser().resolve()
    target = parent / f"{VERSION}-{ARCHIVE_SHA256[:12]}"
    if target.exists():
        _validate_runtime(target)
        return target

    parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{VERSION}-", dir=parent))
    try:
        _extract(temporary)
        (temporary / MARKER_NAME).write_text(f"{ARCHIVE_SHA256}\n", encoding="utf-8")
        _validate_runtime(temporary)
        try:
            temporary.rename(target)
        except OSError:
            if not target.exists():
                raise
            _validate_runtime(target)
        return target
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def runtime_info(root: Path) -> dict[str, object]:
    return {
        "version": VERSION,
        "commit": COMMIT,
        "archiveSha256": ARCHIVE_SHA256,
        "root": str(root),
        "pythonExecutable": str(Path(os.sys.executable).resolve()),
        "skills": {name: str(root / "skills" / name) for name in SKILL_NAMES},
    }
