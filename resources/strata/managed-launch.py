"""Prepare with the pinned Strata control package, then serve in this process."""

import sys

from strata_cli import cli
from strata_cli.launch.catalog import Catalog
from strata_cli.launch.cmd import apply_defaults, settings_from_args
from strata_cli.launch.runner import LaunchError, Runner


def main(argv: list[str]) -> int:
    args = cli.parser().parse_args(["launch", *argv])
    catalog = Catalog()
    settings, _ = settings_from_args(args, catalog)
    runner = Runner(settings, catalog=catalog, assume_yes=True)
    try:
        runner.check_own_files()
        settings, notices = apply_defaults(settings, catalog)
        for notice in notices:
            if notice.level == "error":
                print(notice.line(), file=sys.stderr)
                return 2
        runner.s = settings
        prepared = runner.run(start=False)
    except LaunchError as error:
        print(error.text, file=sys.stderr)
        return error.code
    if not prepared.serving:
        print(prepared.engine_problem or "Strata engine unavailable", file=sys.stderr)
        return 5
    return cli.main([
        "serve", "--config", prepared.config, "--host", "127.0.0.1",
        "--port", str(args.port), "--output", "jsonl",
    ])


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
