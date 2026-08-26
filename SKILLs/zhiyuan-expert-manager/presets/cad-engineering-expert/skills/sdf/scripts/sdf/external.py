from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import tempfile

from .findings import ValidationResult

GzCheckMode = str


def run_gz_sdf_check(xml_text: str, *, output_path: Path, mode: GzCheckMode = "auto") -> ValidationResult:
    result = ValidationResult()
    normalized_mode = str(mode or "auto").strip().lower()
    if normalized_mode not in {"auto", "required", "never"}:
        raise ValueError("gz_check must be one of: auto, required, never")
    if normalized_mode == "never":
        result.add("info", "gz_check_skipped", "gz sdf --check skipped by request")
        return result

    gz_path = shutil.which("gz")
    if gz_path is None:
        severity = "error" if normalized_mode == "required" else "warning"
        result.add(
            severity,
            "gz_check_unavailable",
            "gz sdf --check skipped because 'gz' is not on PATH",
        )
        return result

    output_parent = output_path.resolve().parent
    output_parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".sdf", dir=output_parent, delete=False) as handle:
        temp_path = Path(handle.name)
        handle.write(xml_text if xml_text.endswith("\n") else xml_text + "\n")
    try:
        completed = subprocess.run(
            [gz_path, "sdf", "--check", str(temp_path)],
            check=False,
            capture_output=True,
            text=True,
        )
    finally:
        temp_path.unlink(missing_ok=True)

    if completed.returncode != 0:
        details = (completed.stderr or completed.stdout or "").strip()
        message = "gz sdf --check failed"
        if details:
            message = f"{message}: {details}"
        result.add("error", "gz_check_failed", message)
    else:
        result.add("info", "gz_check_passed", "gz sdf --check passed")
    return result
