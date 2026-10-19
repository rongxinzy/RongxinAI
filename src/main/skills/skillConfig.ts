import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { NpmCli, resolveBundledNpmRuntime } from '../libs/npmRuntime';
import { buildSkillEnv } from './envUtils';
import { runScriptWithTimeout } from './processRunner';

export function getSkillConfigFromDir(skillDir: string): {
  success: boolean;
  config?: Record<string, string>;
  error?: string;
} {
  try {
    const envPath = path.join(skillDir, '.env');
    if (!fs.existsSync(envPath)) {
      return { success: true, config: {} };
    }
    const raw = fs.readFileSync(envPath, 'utf8');
    const config: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let value = trimmed.slice(eqIdx + 1).trim();
      // Strip surrounding quotes added by setSkillConfig / manual edits.
      // Double-quoted values may contain escape sequences (\", \\) that need reversal.
      // Single-quoted values are taken literally (no escape processing), matching dotenv behavior.
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      config[key] = value;
    }
    return { success: true, config };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to read skill config',
    };
  }
}

export function setSkillConfigToDir(
  skillDir: string,
  config: Record<string, string>,
): { success: boolean; error?: string } {
  try {
    const envPath = path.join(skillDir, '.env');
    const lines = Object.entries(config)
      .filter(([key]) => key.trim())
      .map(([key, value]) => {
        // Wrap value in double quotes if it contains characters that dotenv
        // would misinterpret (e.g. # treated as inline comment, or spaces)
        if (
          value.includes('#') ||
          value.includes(' ') ||
          value.includes('"') ||
          value.includes("'")
        ) {
          // Escape any existing double quotes inside the value
          const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          return `${key}="${escaped}"`;
        }
        return `${key}=${value}`;
      });
    fs.writeFileSync(envPath, lines.join('\n') + '\n', 'utf8');
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to write skill config',
    };
  }
}

function repairSkillFromBundled(bundledRoot: string, skillId: string, skillDir: string): boolean {
  if (!app.isPackaged) return false;

  if (!bundledRoot || !fs.existsSync(bundledRoot)) {
    return false;
  }

  const bundledPath = path.join(bundledRoot, skillId);
  if (!fs.existsSync(bundledPath) || bundledPath === skillDir) {
    return false;
  }

  // Check if bundled version has node_modules
  const bundledNodeModules = path.join(bundledPath, 'node_modules');
  if (!fs.existsSync(bundledNodeModules)) {
    console.log(`[skills] Bundled ${skillId} does not have node_modules, skipping repair`);
    return false;
  }

  try {
    console.log(`[skills] Repairing ${skillId} from bundled resources...`);
    fs.cpSync(bundledPath, skillDir, {
      recursive: true,
      dereference: true,
      force: true,
      errorOnExist: false,
    });
    console.log(`[skills] Repaired ${skillId} from bundled resources`);
    return true;
  } catch (error) {
    console.warn(`[skills] Failed to repair ${skillId} from bundled resources:`, error);
    return false;
  }
}

/**
 * One install per skill dir. The node_modules existence check and the npm
 * install are not atomic; now that the flow is async, two concurrent callers
 * could interleave and the second would see a half-built node_modules and
 * "succeed". Concurrent callers share the in-flight promise instead.
 */
const inFlightInstallsByDir = new Map<string, Promise<{ success: boolean; error?: string }>>();

export function ensureSkillDirDependencies(
  skillDir: string,
  bundledRoot: string,
): Promise<{ success: boolean; error?: string }> {
  const inFlight = inFlightInstallsByDir.get(skillDir);
  if (inFlight) return inFlight;
  const pending = installSkillDirDependencies(skillDir, bundledRoot).finally(() => {
    inFlightInstallsByDir.delete(skillDir);
  });
  inFlightInstallsByDir.set(skillDir, pending);
  return pending;
}

async function installSkillDirDependencies(
  skillDir: string,
  bundledRoot: string,
): Promise<{ success: boolean; error?: string }> {
  const nodeModulesPath = path.join(skillDir, 'node_modules');
  const packageJsonPath = path.join(skillDir, 'package.json');
  const skillId = path.basename(skillDir);

  console.log(`[skills] Checking dependencies for ${skillId}...`);
  console.log(`[skills]   node_modules exists: ${fs.existsSync(nodeModulesPath)}`);
  console.log(`[skills]   package.json exists: ${fs.existsSync(packageJsonPath)}`);
  console.log(`[skills]   skillDir: ${skillDir}`);

  // If node_modules exists, assume dependencies are installed
  if (fs.existsSync(nodeModulesPath)) {
    console.log(`[skills] Dependencies already installed for ${skillId}`);
    return { success: true };
  }

  // If no package.json, nothing to install
  if (!fs.existsSync(packageJsonPath)) {
    console.log(`[skills] No package.json found for ${skillId}, skipping install`);
    return { success: true };
  }

  // Try to repair from bundled resources first (works without npm)
  if (repairSkillFromBundled(bundledRoot, skillId, skillDir)) {
    if (fs.existsSync(nodeModulesPath)) {
      console.log(`[skills] Dependencies restored from bundled resources for ${skillId}`);
      return { success: true };
    }
  }

  // Build environment with user's shell PATH (crucial for packaged apps)
  const env = (await buildSkillEnv()) as NodeJS.ProcessEnv;
  const pathKeys = Object.keys(env).filter(k => k.toLowerCase() === 'path');
  console.log(`[skills]   PATH keys in env: ${JSON.stringify(pathKeys)}`);
  console.log(`[skills]   PATH (first 300 chars): ${env.PATH?.substring(0, 300)}`);

  const bundledNpm = resolveBundledNpmRuntime(NpmCli.Npm, ['install']);
  if (!bundledNpm) {
    const errorMsg =
      'Bundled npm runtime is unavailable and the skill cannot be installed. Please reinstall the application.';
    console.error(`[skills] ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  console.log(`[skills] bundled npm runtime is available`);

  // Try to install dependencies
  console.log(`[skills] Installing dependencies for ${skillId}...`);
  console.log(`[skills]   Working directory: ${skillDir}`);

  try {
    const result = await runScriptWithTimeout({
      command: bundledNpm.command,
      args: bundledNpm.args,
      cwd: skillDir,
      env: { ...env, ...bundledNpm.env },
      timeoutMs: 120000, // 2 minute timeout
    });

    console.log(`[skills] npm install exit code: ${result.exitCode}`);
    if (result.stdout) {
      console.log(`[skills] npm install stdout: ${result.stdout.substring(0, 500)}`);
    }
    if (result.stderr) {
      console.log(`[skills] npm install stderr: ${result.stderr.substring(0, 500)}`);
    }

    if (!result.success) {
      const errorMsg = result.error || result.stderr || result.stdout || 'npm install failed';
      console.error(`[skills] Failed to install dependencies for ${skillId}:`, errorMsg);
      return { success: false, error: `Failed to install dependencies: ${errorMsg}` };
    }

    // Verify node_modules was created
    if (!fs.existsSync(nodeModulesPath)) {
      const errorMsg = 'npm install appeared to succeed but node_modules was not created';
      console.error(`[skills] ${errorMsg}`);
      return { success: false, error: errorMsg };
    }

    console.log(`[skills] Dependencies installed successfully for ${skillId}`);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[skills] Error installing dependencies for ${skillId}:`, errorMsg);
    return { success: false, error: `Failed to install dependencies: ${errorMsg}` };
  }
}
