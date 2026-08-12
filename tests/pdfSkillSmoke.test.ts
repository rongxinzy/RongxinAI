import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { test } from "vitest";

const root = path.resolve(__dirname, "..");
const skillRoot = path.join(root, "SKILLs", "pdf");

test("PDF skill exposes an executable visual-QA route through the managed uv runtime", () => {
  const inspector = path.join(skillRoot, "scripts", "pdf_inspect.py");
  assert.equal(existsSync(inspector), true, "PDF visual inspector is missing");
  execFileSync("python3", [inspector, "--help"], { stdio: "pipe" });

  const instructions = readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  assert.match(instructions, /uv run --with pypdfium2 --with pillow/);
  assert.match(instructions, /contact-sheet\.png/);
  assert.match(instructions, /inspection\.json/);

  const pipeline = readFileSync(
    path.join(skillRoot, "scripts", "make.sh"),
    "utf8",
  );
  assert.match(pipeline, /run --quiet --no-project --python/);
  assert.doesNotMatch(pipeline, /--break-system-packages/);

  for (const entry of readdirSync(path.join(skillRoot, "scripts"))) {
    if (!entry.endsWith(".py")) continue;
    const source = readFileSync(path.join(skillRoot, "scripts", entry), "utf8");
    assert.doesNotMatch(source, /--break-system-packages/);
  }
});
