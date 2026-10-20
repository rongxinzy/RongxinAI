/**
 * Comprehensive System & Hardware Diagnostics Collector.
 *
 * Captures machine specifications, OS details, runtime versions, process memory,
 * and GPU acceleration info for logging at startup and exporting diagnostics.
 */

import { app, type GPUFeatureStatus } from 'electron';
import os from 'os';

interface CpuDiagnostics {
  model: string;
  cores: number;
  speedMHz: number;
}

interface MemoryDiagnostics {
  totalBytes: number;
  freeBytes: number;
  totalGB: string;
  freeGB: string;
  processRssMB: string;
  processHeapTotalMB: string;
  processHeapUsedMB: string;
}

interface OsDiagnostics {
  platform: NodeJS.Platform;
  arch: string;
  type: string;
  release: string;
  version: string;
  uptimeHours: string;
}

interface RuntimeDiagnostics {
  appVersion: string;
  isPackaged: boolean;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  v8Version: string;
}

interface GpuDiagnostics {
  devices: Array<{
    vendorId?: number;
    deviceId?: number;
    gpuDeviceString?: string;
    driverVersion?: string;
    driverVendor?: string;
  }>;
  featureStatus?: GPUFeatureStatus | Record<string, string>;
  error?: string;
}

export interface SystemDiagnosticsSnapshot {
  timestamp: string;
  runtime: RuntimeDiagnostics;
  os: OsDiagnostics;
  cpu: CpuDiagnostics;
  memory: MemoryDiagnostics;
  gpu?: GpuDiagnostics;
  paths: {
    userData: string;
    appData?: string;
    exe?: string;
  };
}

export type SynchronousSystemInfo = Omit<SystemDiagnosticsSnapshot, 'gpu' | 'timestamp'> & {
  timestamp?: string;
};

function bytesToGB(bytes: number): string {
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function bytesToMB(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Capture immediate synchronous system information available at earliest process startup
 * (before app.whenReady() or GPU initialization).
 */
export function getSynchronousSystemInfo(): SynchronousSystemInfo {
  const cpus = os.cpus() || [];
  const firstCpu = cpus[0];
  const memUsage = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  let osVersion = '';
  try {
    if (typeof (os as unknown as { version?: () => string }).version === 'function') {
      osVersion = (os as unknown as { version: () => string }).version() || '';
    }
  } catch {
    // os.version() might throw on older unsupported systems
  }

  let userData = '';
  let exePath = '';
  try {
    userData = app.isReady() ? app.getPath('userData') : '';
    exePath = process.execPath;
  } catch {
    // Ignore early path retrieval errors
  }

  return {
    runtime: {
      appVersion: app.getVersion() || 'unknown',
      isPackaged: app.isPackaged,
      electronVersion: process.versions.electron || 'unknown',
      nodeVersion: process.versions.node || process.version,
      chromeVersion: process.versions.chrome || 'unknown',
      v8Version: process.versions.v8 || 'unknown',
    },
    os: {
      platform: process.platform,
      arch: process.arch,
      type: os.type(),
      release: os.release(),
      version: osVersion,
      uptimeHours: (os.uptime() / 3600).toFixed(1),
    },
    cpu: {
      model: firstCpu?.model?.trim() || 'Unknown CPU',
      cores: cpus.length,
      speedMHz: firstCpu?.speed || 0,
    },
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      totalGB: bytesToGB(totalMem),
      freeGB: bytesToGB(freeMem),
      processRssMB: bytesToMB(memUsage.rss),
      processHeapTotalMB: bytesToMB(memUsage.heapTotal),
      processHeapUsedMB: bytesToMB(memUsage.heapUsed),
    },
    paths: {
      userData,
      exe: exePath,
    },
  };
}

/**
 * Capture full system diagnostics snapshot including GPU details (asynchronously).
 * Safe to call after app.whenReady().
 */
export async function getSystemDiagnosticsSnapshot(): Promise<SystemDiagnosticsSnapshot> {
  const base = getSynchronousSystemInfo();
  let gpuInfo: GpuDiagnostics | undefined;

  if (app.isReady()) {
    try {
      const basic = (await app.getGPUInfo('basic')) as {
        gpuDevice?: Array<{
          vendorId?: number;
          deviceId?: number;
          gpuDeviceString?: string;
          driverVersion?: string;
          driverVendor?: string;
        }>;
      };
      const featureStatus = app.getGPUFeatureStatus();
      gpuInfo = {
        devices: (basic.gpuDevice || []).map(d => ({
          vendorId: d.vendorId,
          deviceId: d.deviceId,
          gpuDeviceString: d.gpuDeviceString,
          driverVersion: d.driverVersion,
          driverVendor: d.driverVendor,
        })),
        featureStatus,
      };
    } catch (error) {
      gpuInfo = {
        devices: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    ...base,
    timestamp: new Date().toISOString(),
    gpu: gpuInfo,
    paths: {
      ...base.paths,
      userData: app.isReady() ? app.getPath('userData') : base.paths.userData,
      appData: app.isReady() ? app.getPath('appData') : undefined,
    },
  };
}

/**
 * Format system diagnostics into a clean human-readable diagnostic report text.
 */
export function formatDiagnosticsSummaryText(
  info: SynchronousSystemInfo | SystemDiagnosticsSnapshot,
): string {
  const lines: string[] = [];
  lines.push('==================== SYSTEM & HARDWARE DIAGNOSTICS ====================');
  lines.push(
    `Timestamp       : ${'timestamp' in info && info.timestamp ? info.timestamp : new Date().toISOString()}`,
  );
  lines.push(
    `Application     : ZhiYuanAgent v${info.runtime.appVersion} (${info.runtime.isPackaged ? 'production' : 'development'})`,
  );
  lines.push(
    `Runtimes        : Electron ${info.runtime.electronVersion}, Node ${info.runtime.nodeVersion}, Chrome ${info.runtime.chromeVersion}`,
  );
  lines.push(
    `Operating System: ${info.os.type} ${info.os.release} (${info.os.platform} ${info.os.arch}) ${info.os.version ? '[' + info.os.version + ']' : ''}`,
  );
  lines.push(
    `CPU Hardware    : ${info.cpu.model} (${info.cpu.cores} logical cores, ~${info.cpu.speedMHz} MHz)`,
  );
  lines.push(`System Memory   : ${info.memory.totalGB} total, ${info.memory.freeGB} free`);
  lines.push(
    `Process Memory  : RSS ${info.memory.processRssMB}, Heap ${info.memory.processHeapUsedMB} / ${info.memory.processHeapTotalMB}`,
  );

  if ('gpu' in info && info.gpu) {
    if (info.gpu.devices && info.gpu.devices.length > 0) {
      lines.push('GPU Devices     :');
      for (const dev of info.gpu.devices) {
        const desc =
          dev.gpuDeviceString ||
          `Vendor 0x${(dev.vendorId || 0).toString(16)} Device 0x${(dev.deviceId || 0).toString(16)}`;
        const driver = dev.driverVersion ? ` (Driver: ${dev.driverVersion})` : '';
        lines.push(`  - ${desc}${driver}`);
      }
    } else if (info.gpu.error) {
      lines.push(`GPU Status      : Unavailable (${info.gpu.error})`);
    }

    if (info.gpu.featureStatus) {
      const features = Object.entries(info.gpu.featureStatus)
        .slice(0, 6)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      lines.push(`GPU Features    : ${features}`);
    }
  }

  if (info.paths.userData) {
    lines.push(`UserData Path   : ${info.paths.userData}`);
  }
  lines.push('======================================================================');
  return lines.join('\n');
}

/**
 * Format a compact startup summary banner for application log files.
 */
export function formatStartupLogBanner(info: SynchronousSystemInfo): string[] {
  return [
    '='.repeat(70),
    `ZhiYuanAgent v${info.runtime.appVersion} started (${info.os.platform} ${info.os.arch}, ${info.runtime.isPackaged ? 'production' : 'development'})`,
    `OS: ${info.os.type} ${info.os.release}${info.os.version ? ' (' + info.os.version + ')' : ''}`,
    `CPU: ${info.cpu.model} [${info.cpu.cores} cores] | RAM: ${info.memory.totalGB} total, ${info.memory.freeGB} free`,
    `Runtime: Electron ${info.runtime.electronVersion}, Node ${info.runtime.nodeVersion}, Chrome ${info.runtime.chromeVersion}`,
    '='.repeat(70),
  ];
}
