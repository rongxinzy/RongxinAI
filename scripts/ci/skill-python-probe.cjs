'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  buildProbeCode,
  listRequirementFiles,
  parseImportNames,
  selectCoreRequirements,
} = require('../setup-skill-python-runtime.js');

function createSkillPythonProbe(projectRoot) {
  const requirements = selectCoreRequirements(
    listRequirementFiles(path.join(projectRoot, 'SKILLs')),
  );
  const imports = [
    ...new Set(requirements.flatMap(entry => parseImportNames(entry.requirementsPath))),
  ].sort();
  if (imports.length === 0) throw new Error('No offline Skill Python dependencies to probe');
  return buildProbeCode(imports);
}

if (require.main === module) {
  const [projectRoot, outputPath] = process.argv.slice(2);
  if (!projectRoot || !outputPath)
    throw new Error('Usage: skill-python-probe.cjs <project-root> <output.py>');
  fs.writeFileSync(outputPath, createSkillPythonProbe(projectRoot), 'utf8');
}

module.exports = { createSkillPythonProbe };
