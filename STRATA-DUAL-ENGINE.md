# Windows CUDA dual-engine (llama.cpp + Strata)

The **Windows CUDA (win-cuda)** installer bundles [Strata](https://github.com/Niko1221/Strata) (MIT) alongside llama.cpp. Lite / cpu / mac / linux editions do **not** ship Strata assets.

## Engine split

| Workload | Engine |
| --- | --- |
| General GGUF, router multi-model, CPU/Vulkan/CUDA backends | **llama.cpp** |
| Qwen3.8-Flash-Next, Qwen3.6-35B-A3B, DeepSeek-V4.1-Flash (Strata-only stacks) | **Strata** (`strata.exe` + `strata-dsv41.exe` + bundled Python control) |

The installer bundles official Strata **v0.2.4** Windows CUDA13 engine tarballs plus `strata-control-0.1.49.2-windows-x86_64.zip` (SHA-256 pinned in `package.json`). Model weights are **not** included.

## GPU exclusivity

- Before starting Strata, the app calls llama.cpp orchestrator **`stopAll`** (unload router models).
- Before loading llama.cpp GPU models on win-cuda, the app **stops Strata**.

## Ports

- llama.cpp gateway default: **8080**
- Strata OpenAI-compatible API default: **8096** (loopback only; configurable via `strata_service_config`)

Magpie provider id: `zhiyuan-host-strata`.

## Hardware / disk gates (Strata documentation only)

Values below are copied from Strata README / `docs/QWEN36.md` / `docs/DEEPSEEK41.md` — **not measured in CI**:

- Qwen Flash-Next / Qwen3.6: combined RAM+VRAM typically ≥32 GB; Flash-Next disk on the order of 40–80 GB; ≥12 GB VRAM recommended.
- DeepSeek-V4.1-Flash: official 2-bit sets **239–274 GB** disk; docs cite 12 GB VRAM + ~46–64 GB system RAM (needs real-GPU validation).

## Real-GPU validation still required

RTX **4090 Laptop (16 GB + 32 GB RAM)** and **4060 Laptop (8 GB + 16/32 GB RAM)**:

- Installer size, NSIS component extract, Strata headless launch, Magpie registration, mutex under load, DeepSeek disk/OOM.

## Attribution

Strata engine/control: **MIT**. Model checkpoints remain under their upstream licenses.
