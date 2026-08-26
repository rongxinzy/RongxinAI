from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from runtime import SKILL_NAMES, ensure_runtime, runtime_info, verify_archive


def main() -> int:
    parser = argparse.ArgumentParser(description="Prepare the bundled text-to-cad runtime")
    parser.add_argument("--cache-root", type=Path)
    parser.add_argument("--skill", choices=SKILL_NAMES)
    parser.add_argument("--json", action="store_true", dest="json_output")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()

    try:
        if args.verify_only:
            verify_archive()
            result: dict[str, object] = {"verified": True}
        else:
            root = ensure_runtime(args.cache_root)
            result = runtime_info(root)
            if args.skill:
                result["selectedSkill"] = result["skills"][args.skill]  # type: ignore[index]
    except (OSError, RuntimeError) as error:
        print(f"text-to-cad bootstrap failed: {error}", file=sys.stderr)
        return 1

    if args.json_output:
        print(json.dumps(result, ensure_ascii=False))
    elif args.skill and "selectedSkill" in result:
        print(result["selectedSkill"])
    elif args.verify_only:
        print("text-to-cad archive verified")
    else:
        print(result["root"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
