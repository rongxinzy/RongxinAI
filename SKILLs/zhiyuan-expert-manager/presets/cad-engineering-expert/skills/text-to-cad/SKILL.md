---
name: text-to-cad
description: Route CAD, robot-description, fabrication, slicing, printer handoff, and local model review tasks through the bundled text-to-cad 0.4.28 runtime. Use for STEP/STP, STL, 3MF, GLB, DXF, URDF, SRDF, SDF, DfAM, G-code, Bambu Labs, off-the-shelf STEP parts, or implicit CAD requests.
---

# text-to-cad runtime router

This Skill packages the MIT-licensed
[earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad) workflows as
one pinned, offline runtime. The upstream files are stored in a checksum-verified
archive so the application does not carry several expanded copies of the same
CAD runtime.

## Required startup

Before reading an upstream workflow, run:

```text
run_skill_script(
  skillId="text-to-cad",
  script="scripts/bootstrap.py",
  args=["--json"]
)
```

The result contains the immutable runtime root and a map of workflow names to
absolute directories. Never guess the cache path and never edit files in it.

## Workflow routing

Select exactly one primary workflow, then read its `SKILL.md` completely from
the returned directory. Load another workflow only when the first one explicitly
hands off to it.

| Request | Primary workflow |
| --- | --- |
| Parametric part, assembly, STEP/STP, measurement, STL/3MF/GLB export | `cad` |
| Local visual review of CAD, DXF, implicit, or robot files | `cad-viewer` |
| Purchasable screws, bearings, motors, boards, connectors, STEP parts | `step-parts` |
| 2D profiles, templates, gaskets, cut layouts, DXF | `dxf` |
| Robot links, joints, limits, inertials, meshes | `urdf` |
| MoveIt groups, end effectors, poses, collision rules | `srdf` |
| Simulation models, worlds, physics, sensors, lights | `sdf` |
| SendCutSend upload readiness | `sendcutsend` |
| Mesh wall thickness, overhang, support, orientation, printability | `dfam-check` |
| Validated mesh to printer-profiled G-code | `gcode` |
| Explicitly authorized Bambu upload or print start | `bambu-labs` |
| Browser-native GLSL signed-distance-field modeling | `implicit-cad` |

## Running upstream Python entries

The application only executes scripts located inside the selected Skill. Use
the checked proxy instead of calling extracted Python files directly:

```text
run_skill_script(
  skillId="text-to-cad",
  script="scripts/run.py",
  args=["cad", "scripts/gen", "models/widget.step.py", "--write"]
)
```

The first argument is the workflow name, the second is a Python file or Python
package entry relative to that workflow, and the remaining arguments are passed
unchanged. The proxy rejects path traversal and non-Python entries.

Common translations:

| Upstream instruction | Proxy arguments |
| --- | --- |
| `python scripts/gen ...` in CAD | `cad`, `scripts/gen`, then original arguments |
| `python scripts/inspect ...` | `cad`, `scripts/inspect`, then original arguments |
| `python scripts/snapshot ...` | owning workflow, `scripts/snapshot`, then original arguments |
| `python scripts/dfam_tool.py ...` | `dfam-check`, `scripts/dfam_tool.py`, then original arguments |
| `python scripts/gcode_tool.py ...` | `gcode`, `scripts/gcode_tool.py`, then original arguments |
| CAD Viewer `npm ... start` | `cad-viewer`, `scripts/viewer/server_py/start_viewer.py`, `--host`, `127.0.0.1`, `--json` |

Run commands from the user's workspace so relative model and output paths stay
there. The proxy preserves the current working directory.

## Non-Python tools

Some workflows call an installed slicer, MoveIt, or another external program.
Follow the selected upstream `SKILL.md` exactly and use ordinary tool approval
for those external commands. Do not substitute a different backend silently.

## Safety and integrity

- The archive SHA-256 is verified before every first extraction.
- Extraction rejects absolute paths, parent traversal, links, devices, and FIFOs.
- Cache contents are immutable runtime files; edit only user workspace sources.
- Never upload a file, connect to a printer, or start a print without explicit
  user authorization.
- Report missing dependencies, unsupported platforms, viewer startup failures,
  and unavailable external tools instead of claiming success.
- Preserve the selected upstream workflow's validation and handoff requirements.

## Provenance

- Upstream version: `0.4.28`
- Upstream commit: `0e94cd1d2b5fa2013d89aa9504ecadcf16ce39f6`
- License: MIT

The expert package root contains the full provenance record. Each extracted
workflow retains its upstream license file.
