"""Fail closed when the CI inventory drifts from PR workflow triggers."""
import json
from pathlib import Path

import yaml

root = Path(__file__).resolve().parent
config = json.loads((root / "devops-ci.json").read_text())
declared = {item["path"]: item for item in config["workflows"]}
optional = {item["path"]: item for item in config.get("optionalWorkflows", [])}
assert len(declared) == len(config["workflows"]), "Duplicate workflow paths"
assert not set(declared) & set(optional), "Workflow cannot be both required and optional"
actual = {}
mapping = {"paths": "paths", "paths-ignore": "pathsIgnore", "branches": "branches", "branches-ignore": "branchesIgnore"}
for path in sorted((root / "workflows").glob("*")):
    if path.suffix not in {".yml", ".yaml"} or path.name == "devops-gate.yml":
        continue
    data = yaml.safe_load(path.read_text())
    events = data.get("on", data.get(True, {}))
    if isinstance(events, str):
        events = {events: None}
    elif isinstance(events, list):
        events = dict.fromkeys(events)
    if "pull_request" not in events:
        continue
    name = ".github/workflows/" + path.name
    trigger = events["pull_request"] or {}
    if name in optional:
        assert optional[name].get("reason"), f"Missing optional reason: {name}"
        continue
    types = trigger.get("types", ["opened", "synchronize", "reopened"])
    assert set(["opened", "synchronize", "reopened"]) <= set(types), f"Explicitly classify nonstandard event workflow: {name}"
    item = {"name": data.get("name", path.name), "path": name}
    for source, target in mapping.items():
        if source in trigger:
            item[target] = trigger[source]
            for pattern in trigger[source]:
                assert not any(c in pattern for c in "[]+"), f"Unsupported filter syntax: {name}: {pattern}"
    actual[name] = item
assert set(optional) <= {".github/workflows/" + p.name for p in (root / "workflows").glob("*")}, "Optional workflow does not exist"
assert declared == actual, f"CI inventory drift: update devops-ci.json. Required workflow paths: {sorted(actual)}"
print(f"PASS: {len(actual)} required PR workflows, {len(optional)} explicit optional workflows")
