// Local inference: service and runtime
export const enLocalInferenceService: Record<string, string> = {
  localInferenceBackendSwitchRequiresStoppedService:
    'Stop the local inference service before switching versions.',
  localInferenceBackendInUse: 'In use',
  localInferenceRuntimeSettings: 'Runtime',
  localInferenceRuntimeReadyWithBackend: 'Current version: {backend}',
  localInferenceRuntimeNoSelectedVersion: 'No version selected',
  localInferenceRuntimeNotInstalledMessage: 'The local inference engine is not installed.',
  localInferenceRuntimeServiceRunning: 'Service is running',
  localInferenceRuntimeServiceNotRunning: 'Service is installed but not running',
  localInferenceRuntimeServiceUnavailable: 'The local inference service is not installed',
  localInferenceService: 'Llama.cpp Service',
  localInferenceServiceHint: '{local} local models registered, {running} models loaded.',
  localInferenceServiceManagedByApp: 'Managed by this app',
  localInferenceServiceExternal: 'External process',
  localInferenceServiceConfigTitle: 'local inference Service Settings',
  localInferenceServiceConfigDescription:
    'Only common service behavior is shown here. Configure context, GPU offload, threads, batch size, and mmap when launching a model.',
  localInferenceServiceConfigSaved:
    'local inference service parameters saved. They will apply on next start.',
  localInferenceServiceConfigSavedRestartRequired:
    'local inference service parameters saved. Restart local inference to apply them.',
  localInferenceServiceConfigSanitizedNotice:
    'Some parameters were out of the safe range and were reset to defaults: {fields}',
  localInferenceServiceConfigValidationFixErrors: 'Fix invalid service parameters before saving.',
  localInferenceLoadModelLimitReached:
    'The loaded model limit is {limit}. You cannot start model number {next}; unload an existing model first.',
  localInferenceResidencyTitle: 'Keep Active',
  localInferenceResidencyDuration: 'Release after idle',
  localInferenceResidencyImmediate: 'Immediately',
  localInferenceResidencyFiveMinutes: '5 minutes',
  localInferenceResidencyThirtyMinutes: '30 minutes',
  localInferenceResidencyOneHour: '1 hour',
  localInferenceResidencyForever: 'Keep loaded',
  localInferenceResidencyCustom: 'Custom',
  localInferenceResidencySaved: 'Model residency policy saved',
  localInferenceServiceConfigRestartAppRequired:
    'The app main process has not loaded service parameter support yet. Restart the app before saving.',
  localInferenceServiceConfigExternalWarning:
    'local inference is currently started by an external process. Service startup parameters saved here will not affect that running service.',
  localInferenceServiceConfigExternalHint:
    'Stop the external local inference first, then start the service from this app for these parameters to apply.',
  localInferenceServiceConfigExternalNotApplied:
    'local inference is running as an external process, so service startup parameters cannot be applied. Stop the external local inference first, then start it from this app.',
  localInferenceServiceConfigRestartRequired: 'Requires service restart',
  localInferenceServiceConfigGroupBasic: 'Basic',
  localInferenceServiceConfigGroupPerformance: 'Performance',
  localInferenceServiceConfigGroupCache: 'Cache',
  localInferenceServiceConfigGroupAdvanced: 'Advanced',
  localInferenceServiceConfigAdvancedDescription:
    'Expand only for troubleshooting, multi-GPU tuning, or template tuning. Keep defaults if unsure.',
  localInferenceServiceConfigGroupService: 'Service control',
  localInferenceServiceConfigGroupServiceDescription:
    'Controls router loading behavior, request concurrency, HTTP threads, and timeout.',
  localInferenceServiceConfigGroupCacheDescription:
    'Tune prompt caching, cache reuse, and long-session throughput.',
  localInferenceServiceConfigGroupGpu: 'GPU acceleration',
  localInferenceServiceConfigGroupGpuDescription:
    'Shown only when the current runtime reports usable GPU acceleration.',
  localInferenceServiceConfigGroupCompat: 'Compatibility and memory',
  localInferenceServiceConfigGroupCompatDescription:
    'Template compatibility and common memory residency controls.',
  localInferenceServiceConfigGroupRequest: 'Concurrency and requests',
  localInferenceServiceConfigGroupRequestDescription:
    'Configure request slots and HTTP worker threads together.',
  localInferenceServiceConfigGpuHiddenHint:
    'The current runtime did not report usable GPU acceleration parameters, so GPU-specific settings are hidden.',
  localInferenceServiceConfigHostLabel: 'Listen address',
  localInferenceServiceConfigPortLabel: 'Port',
  localInferenceServiceConfigExecutablePathLabel: 'llama-server path',
  localInferenceServiceConfigCtxSizeLabel: 'Context length',
  localInferenceServiceConfigParallelLabel: 'Concurrent slots',
  localInferenceServiceConfigGpuLayersLabel: 'GPU offload',
  localInferenceServiceConfigDeviceLabel: 'Visible devices',
  localInferenceServiceConfigModelsMaxLabel: 'Loaded model limit',
  localInferenceServiceConfigModelsAutoloadLabel: 'Autoload models',
  localInferenceServiceConfigBatchSizeLabel: 'Batch size',
  localInferenceServiceConfigUbatchSizeLabel: 'Micro-batch size',
  localInferenceServiceConfigThreadsLabel: 'Inference threads',
  localInferenceServiceConfigThreadsBatchLabel: 'Batch threads',
  localInferenceServiceConfigThreadsHttpLabel: 'HTTP threads',
  localInferenceServiceConfigTimeoutLabel: 'Timeout (seconds)',
  localInferenceServiceConfigCachePromptLabel: 'Prompt cache',
  localInferenceServiceConfigCacheReuseLabel: 'Cache reuse',
  localInferenceServiceConfigCacheRamLabel: 'RAM cache',
  localInferenceServiceConfigJinjaLabel: 'Jinja template',
  localInferenceServiceConfigSplitModeLabel: 'Split mode',
  localInferenceServiceConfigTensorSplitLabel: 'Tensor split',
  localInferenceServiceConfigMainGpuLabel: 'Main GPU',
  localInferenceServiceConfigFlashAttnLabel: 'Flash Attention',
  localInferenceServiceConfigMmapLabel: 'mmap',
  localInferenceServiceConfigMlockLabel: 'mlock',
  localInferenceServiceConfigHostHint:
    'local inference listen address. Keep 127.0.0.1 for local desktop use.',
  localInferenceServiceConfigPortHint:
    'OpenAI-compatible API port. Clients will connect to this port after it changes.',
  localInferenceKeepRunningOnAppQuit: 'Keep service running after app quit',
  localInferenceServiceConfigExecutablePathHint:
    'Advanced option. Fill this only when explicitly using an existing llama-server. Leave empty to use the app-managed fixed runtime.',
  localInferenceServiceConfigExecutablePathPlaceholder: 'Example: /usr/local/bin/llama-server',
  localInferenceServiceConfigDeviceHint:
    'Limit visible local inference devices. Enter device indexes such as 0, 1, or 2. Separate multiple values with commas. The app maps them to real device IDs when saving. Leave empty to keep all devices visible.',
  localInferenceServiceConfigNumGpuHint:
    'Default GPU offload layers; -1 tries full GPU offload, 0 means CPU only.',
  localInferenceServiceConfigModelsMaxHint:
    'Number of models allowed to stay loaded in memory at once. Use 1 for a desktop single-model setup, 2 for switching between models, or leave empty for no limit.',
  localInferenceServiceConfigModelsAutoloadHint:
    'Whether the service loads preset models automatically when it starts.',
  localInferenceServiceConfigParallelHint:
    'Concurrent requests per model. Use 1 for desktop interaction, 2 for light concurrency. Higher values increase VRAM and memory pressure.',
  localInferenceServiceConfigCtxSizeHint:
    'Default context length. For Agent engine-style long prompts, start with 8192 or 16384.',
  localInferenceServiceConfigGpuLayersHint:
    'GPU offload layers. auto lets local inference decide; all tries full offload.',
  localInferenceServiceConfigBatchSizeHint:
    'Logical prompt processing batch size. Higher is faster but uses more VRAM and memory.',
  localInferenceServiceConfigUbatchSizeHint:
    'Physical micro-batch size. Lower it when VRAM is tight.',
  localInferenceServiceConfigThreadsHint:
    'CPU threads for generation. Leave empty for the local inference default.',
  localInferenceServiceConfigThreadsBatchHint:
    'CPU threads for prompt batch processing. Leave empty for the local inference default.',
  localInferenceServiceConfigTimeoutHint:
    'local inference connection and load timeout in seconds. Increase it for larger models or slower devices.',
  localInferenceServiceConfigThreadsHttpHint:
    'HTTP worker threads. Leave empty for automatic selection.',
  localInferenceServiceConfigCachePromptHint:
    'Enable prompt caching for long prompts and repeated conversations.',
  localInferenceServiceConfigCacheReuseHint:
    'Prompt/KV cache reuse threshold. Smaller values reuse more aggressively, larger values are more conservative. 256 is a common desktop value.',
  localInferenceServiceConfigCacheRamHint:
    'RAM limit for prompt/KV cache in MiB. -1 means unlimited, 0 disables it, and empty uses the default.',
  localInferenceServiceConfigFlashAttnHint:
    'Flash Attention mode. Supported backends can reduce VRAM usage.',
  localInferenceServiceConfigJinjaHint:
    'Enable Jinja chat templates. Tool calls and complex templates usually need it.',
  localInferenceServiceConfigSplitModeHint:
    'Multi-GPU split strategy. Leave empty for the default.',
  localInferenceServiceConfigTensorSplitHint:
    'Tensor split ratio across GPUs, for example 3,2. Usually used with tensor split mode.',
  localInferenceServiceConfigMainGpuHint:
    'Main GPU index for multi-GPU or memory-placement tuning.',
  localInferenceServiceConfigGpuUnavailableHint:
    'The current local inference runtime did not report any configurable GPU. Only CPU or no accelerator devices were detected.',
  localInferenceServiceConfigGpuDetectionFailedHint:
    'The current local inference runtime did not provide usable GPU enumeration results, so GPU parameters cannot be configured.',
  localInferenceServiceConfigFieldErrorIntegerRange: 'Enter an integer between {min} and {max}.',
  localInferenceServiceConfigFieldErrorDeviceFormat:
    'Enter device indexes separated by commas, for example 0,1.',
  localInferenceServiceConfigFieldErrorDeviceUnavailable:
    'No configurable GPU is available in the current runtime, so visible devices cannot be set.',
  localInferenceServiceConfigFieldErrorDeviceDetectionFailed:
    'The current runtime did not provide usable GPU enumeration results, so visible devices cannot be set.',
  localInferenceServiceConfigFieldErrorDeviceOutOfRange:
    'Device indexes are outside the available GPU range. Enter a value between {min} and {max}.',
  localInferenceServiceConfigFieldErrorDeviceIndexRange:
    'Device index is out of range. The maximum available index is {max}.',
  localInferenceServiceConfigFieldErrorGpuLayersFormat:
    'Enter an integer between 0 and 4096, or use auto / all.',
  localInferenceServiceConfigFieldErrorMainGpuUnavailable:
    'No configurable GPU is available in the current runtime, so Main GPU cannot be set.',
  localInferenceServiceConfigFieldErrorMainGpuDetectionFailed:
    'The current runtime did not provide usable GPU enumeration results, so Main GPU cannot be set.',
  localInferenceServiceConfigFieldErrorMainGpuOutOfRange:
    'Main GPU is outside the available GPU range. Enter a value between {min} and {max}.',
  localInferenceServiceConfigFieldErrorTensorSplitFormat:
    'Enter comma-separated positive numbers such as 3,2 or 1,1,0.5.',
  localInferenceServiceConfigFieldErrorTensorSplitRequiresMode:
    'Tensor split is available only when split mode is tensor.',
  localInferenceServiceConfigTensorSplitDisabledHint:
    'Available only when split mode is set to tensor.',
  localInferenceServiceConfigMainGpuDisabledHint:
    'The current split mode does not use a main GPU setting.',
  localInferenceServiceConfigPromptCacheDependentHint:
    'Takes effect only when prompt cache is enabled or left at the default setting.',
  localInferenceServiceConfigMmapHint:
    'Whether to load models with memory mapping. Disabled maps to local inference no-mmap.',
  localInferenceServiceConfigMlockHint:
    'Lock model memory to avoid swapping. This can require more available RAM.',
  localInferenceServiceConfigSplitNone: 'No split',
  localInferenceServiceConfigSplitLayer: 'Layer split',
  localInferenceServiceConfigSplitRow: 'Row split',
  localInferenceServiceConfigSplitTensor: 'Tensor split',
  localInferenceServiceConfigRestartHint:
    'local inference is running. Restart the service to apply saved values.',
  localInferenceServiceConfigStartHint: 'Saved values apply the next time local inference starts.',
  localInferenceInstall: 'Install',
  localInferenceRuntimeCardTitle: 'Local inference runtime',
  localInferenceRuntimeCardDescription:
    'Optional and independent from the rest of the app. Download, verification, and installation run here.',
  localInferenceRuntimeDownloadSize: 'Estimated download {size}',
  localInferenceRuntimeDownloadSizeUnknown: 'Size pending server metadata',
  localInferenceRuntimeRetry: 'Retry',
  localInferenceBackendManager: 'local inference Backend',
  localInferenceBackendConfigTitle: 'local inference Config',
  localInferenceBackendConfigDescription:
    'Manage local inference version and backend. Service parameters remain in local inference service settings.',
  localInferenceBackendListFailed:
    'Could not read the local inference backend list. Refresh, or restart the app to load the latest main/preload code.',
  localInferenceBackendListEmpty:
    'No backend is available. Ensure the Gitee release has manifest.json, or restart the app to use the built-in fallback.',
  localInferenceBackendHandlerMissing:
    'The running app has not loaded the new local inference backend IPC yet. Fully quit and restart the app.',
  localInferenceBackendSourceLocal: 'Source: local import',
  localInferenceBackendSourceRemote: 'Source: remote manifest',
  localInferenceBackendVersion: 'Version',
  localInferenceBackendName: 'Backend',
  localInferenceBackendCurrent: 'Current selection',
  localInferenceBackendRecommendedLabel: 'Recommended',
  localInferenceBackendNone: 'None',
  localInferenceBackendRecommended: 'Recommended: {backend}',
  localInferenceBackendRecommendedReason:
    'Recommended {backend} based on current machine capabilities.',
  localInferenceBackendRecommendedUnavailable:
    'No compatible backend is available for the current platform {platform}.',
  localInferenceBackendInstalled: 'The selected backend is installed',
  localInferenceBackendNotInstalled: 'The selected backend is not installed',
  localInferenceBackendRunningHint:
    'Switching backend while the service is running does not affect the current process. Stop and restart the service to apply it.',
  localInferenceBackendSwitch: 'Switch',
  localInferenceBackendUpdate: 'Install / Update',
  localInferenceBackendUpdated: 'local inference backend updated.',
  localInferenceBackendUpdateFailed: 'Failed to update local inference backend.',
  localInferenceBackendUpdateUnavailableLocal:
    'A locally imported backend cannot be updated from the remote source directly. Re-import a newer version or configure a manifest/OSS source first.',
  localInferenceBackendCheckDevices: 'Check devices',
  localInferenceBackendDeviceCheckDone: 'Device check completed.',
  localInferenceBackendDeviceCheckFailed: 'Device check failed.',
  localInferenceBackendNoDevices: 'No device output was reported.',
  localInferenceRuntimeReady: 'local inference is installed and ready.',
  localInferenceRuntimeDownloading: 'Downloading: {name}',
  localInferenceRuntimeDownloadTotal: 'Total: {size}',
  localInferenceRuntimeDownloadSpeed: 'Speed: {speed}/s',
  localInferenceRuntimeDownloadProgress: 'Progress: {completed} / {total}',
  localInferenceRuntimeInstallCancelled: 'Installation cancelled.',
  localInferenceRuntimeEnableVersion: 'Enable version',
  localInferenceRuntimeVersionSwitched: 'Switched to version: {version}.',
  localInferenceRuntimeBackgroundInstallContinues:
    'Version {version} is downloading in the background. Closing this window will not interrupt it.',
  localInferenceRuntimeBackgroundInstallContinuesGeneric:
    'The local inference runtime is downloading in the background. Closing this window will not interrupt it.',
  localInferenceRuntimeBackgroundInstallDone: 'Version {version} has finished downloading.',
  localInferenceRuntimeBackgroundInstallFailed: 'Version {version} failed to download.',
  localInferenceRuntimeMissing:
    'Failed to install local inference. Check the network and try again.',
  localInferenceCudaRequiresNvidiaGpu:
    'The CUDA version requires an NVIDIA GPU. Please select the CPU version.',
  localInferenceServiceNeedsBackendInstall:
    'Install a backend in local inference Config before starting the service.',
  localInferenceServiceNeedsBackendSwitch:
    'Switch to an installed backend in local inference Config before starting the service.',
  localInferenceRuntimeUninstall: 'Uninstall local inference',
  localInferenceRuntimeUninstalled: 'The app-managed local inference has been uninstalled.',
  localInferenceRuntimeNotInstalled: 'No app-managed local inference was found.',
  localInferenceRuntimeUninstallFailed: 'Failed to uninstall local inference.',
  localInferenceStart: 'Start Service',
  localInferenceStop: 'Stop Service',
  localInferenceInstallExtracting: 'Extracting',
  localInferenceInstallVerifying: 'Verifying',
  localInferenceCancelPull: 'Cancel Installation',
  localInferenceServiceStopped: 'local inference is not running. Start the service first.',
  localInferenceLoad: 'Load',
  localInferenceUnload: 'Unload',
  localInferenceLoadingModel: 'Loading...',
  localInferenceCancelModelLoad: 'Cancel startup',
  localInferenceLoadingHint:
    'This model is loading and other model load actions are temporarily locked.',
  localInferenceUnloading: 'Unloading...',
  localInferenceUnloadingHint: 'This model is unloading and its actions are temporarily locked.',
  localInferenceRuntimeContext: 'Loaded context',
  localInferenceSystemPrompt: 'System Prompt',
  localInferenceConfigTitle: 'Inference config',
  localInferenceCommonParams: 'Common parameters',
  localInferenceCommonParamsHint: 'Keep only the parameters you adjust most often.',
  localInferenceConfigBasic: 'Basic',
  localInferenceConfigAdvanced: 'Advanced',
  localInferenceConfigExpand: 'Expand config',
  localInferenceConfigCollapse: 'Collapse config',
  localInferenceOptionRequestParamsTitle: 'Request generation parameters',
  localInferenceOptionAuto: 'Auto',
  localInferenceOptionTemperatureLabel: 'Randomness',
  localInferenceOptionTemperatureHint:
    'Sampling temperature. Higher values produce more varied output.',
  localInferenceOptionTopPLabel: 'Nucleus sampling',
  localInferenceOptionTopPHint:
    'Only sample candidates whose cumulative probability reaches this value.',
  localInferenceOptionTopKLabel: 'Top K',
  localInferenceOptionTopKHint: 'Sample from the K most likely tokens only. 0 disables it.',
  localInferenceOptionMinPLabel: 'Min P',
  localInferenceOptionMinPHint: 'Filters tokens by probability relative to the most likely token.',
  localInferenceOptionMaxTokensLabel: 'Max generated tokens',
  localInferenceOptionMaxTokensHint: 'Sent as max_tokens. -1 means unlimited.',
  localInferenceOptionRepeatPenaltyLabel: 'Repeat penalty',
  localInferenceOptionRepeatPenaltyHint: 'Reduces the chance of repeated token sequences.',
  localInferenceOptionPresencePenaltyLabel: 'Presence penalty',
  localInferenceOptionPresencePenaltyHint:
    'Penalizes tokens that already appeared. Range: -2 to 2.',
  localInferenceSystemPromptHint: 'Use this only when you need a fixed role or response style.',
  localInferenceOptionCachePromptLabel: 'Prompt cache',
  localInferenceOptionCachePromptHint:
    'Whether this request reuses the KV prompt cache. Auto uses the server default.',
  localInferenceOptionSeedLabel: 'Seed',
  localInferenceOptionSeedHint: '-1 is random. Use a non-negative seed for reproducible tests.',
  localInferenceOptionStopLabel: 'Stop sequences',
  localInferenceOptionStopHint: 'Comma-separated stop sequences that end generation.',
  localInferenceStopGeneration: 'Stop generation',
  localInferenceTokenPrompt: 'Prompt',
  localInferenceTokenCompletion: 'Completion',
  localInferenceTokenUsed: 'Used',
  localInferenceTokenRemaining: 'Remaining',
  localInferenceMetricsSpeed: '{speed} tokens/s',
  localInferenceVram: 'VRAM',
  localInferenceLaunchTitle: 'Launch Model',
  localInferenceLaunchLifecycleTitle: 'Launch a desktop model instance',
  localInferenceLaunchLifecycleDescription:
    'Configure how this model is loaded. Changing the GPU preset restarts local inference and then reloads the model.',
  localInferenceLaunchAutoTitle: 'Auto Optimize',
  localInferenceLaunchAutoDescription:
    'Fill conservative values from model size, available VRAM, and CPU threads.',
  localInferenceLaunchAutoFormula:
    'Formula: context is estimated from model size; threads=min(logical threads-2, 16).',
  localInferenceLaunchAutoOptimize: 'Auto Optimize',
  localInferenceLaunchAutoAppliedFallback:
    'Applied conservative parameters: context {context}, GPU acceleration {gpuLayers}, threads {threads}, batch {batch}.',
  localInferenceLaunchAutoAppliedWithGpu:
    'Detected {memory} available GPU memory: context {context}, GPU acceleration {gpuLayers}, threads {threads}, batch {batch}.',
  localInferenceLaunchKeepAlive: 'Residency',
  localInferenceLaunchKeepAliveForever: 'Resident until manually unloaded',
  localInferenceLaunchGpuPresetTitle: 'Workstation GPU Preset',
  localInferenceLaunchGpuPresetDescription:
    'Choose which GPUs local inference can use and how multi-GPU splitting works.',
  localInferenceLaunchGpuServiceDefault: 'Follow service settings',
  localInferenceLaunchGpuServiceDefaultHint:
    'Do not change the current local inference service parameters.',
  localInferenceLaunchGpuSingleAuto: 'GPU 0 only',
  localInferenceLaunchGpuSingleAutoHint:
    'Pin local inference to CUDA0 and disable multi-GPU splitting.',
  localInferenceLaunchGpu0: 'GPU 0 only',
  localInferenceLaunchGpu0Hint: 'Allow local inference to use only the first GPU.',
  localInferenceLaunchGpu1: 'GPU 1 only',
  localInferenceLaunchGpu1Hint: 'Allow local inference to use only the second GPU.',
  localInferenceLaunchGpuDual: 'Use both GPUs',
  localInferenceLaunchGpuDualHint:
    'Pin local inference to CUDA0 and CUDA1, then split layers across both GPUs.',
  localInferenceLaunchGpuCustom: 'Custom',
  localInferenceLaunchGpuCustomHint: 'Manually choose which devices local inference can use.',
  localInferenceLaunchGpuCustomValue: 'GPU devices',
  localInferenceLaunchGpuCustomValueHint:
    'Use indexes like 0,1 or exact device names, comma-separated. Leave empty to keep the current service setting.',
  localInferenceLaunchGpuCurrent: 'Current service',
  localInferenceLaunchGpuWillUse: 'This launch',
  localInferenceLaunchGpuAutoVisible: 'Auto-select',
  localInferenceLaunchGpuKeepService: 'Keep current service settings',
  localInferenceLaunchGpuSpreadOn: 'cross-GPU scheduling on',
  localInferenceLaunchGpuSpreadOff: 'cross-GPU scheduling off',
  localInferenceLaunchGpuRestartNotice:
    'This preset restarts local inference and unloads currently loaded models.',
  localInferenceLaunchRestartFailed:
    'local inference did not enter the running state after restart',
  localInferenceLaunchBasicTitle: 'Basic Parameters',
  localInferenceLaunchBasicDescription:
    'Only the common model startup parameters are shown here. Keep defaults if unsure.',
  localInferenceLaunchNumCtx: 'Context Length',
  localInferenceLaunchNumCtxHint: 'Longer context uses more VRAM and memory.',
  localInferenceLaunchContextExceedsTrainingLimit:
    'The requested context length {requested} exceeds the model training limit {trained}. Lower it before loading the model.',
  localInferenceLaunchAcceleration: 'GPU Acceleration',
  localInferenceLaunchAccelerationAuto: 'Auto',
  localInferenceLaunchAccelerationCpu: 'CPU only',
  localInferenceLaunchAccelerationCustom: 'Custom layers',
  localInferenceLaunchAccelerationHint:
    'Auto leaves this to local inference. CPU only writes n-gpu-layers=0.',
  localInferenceLaunchNumGpu: 'GPU Acceleration Layers',
  localInferenceLaunchNumGpuHint:
    'Written as local inference n-gpu-layers. 0 means CPU, empty uses automatic selection.',
  localInferenceLaunchNumThread: 'Threads',
  localInferenceLaunchNumThreadHint:
    'CPU inference threads; too high can hurt desktop responsiveness.',
  localInferenceLaunchAdvancedTitle: 'Advanced Parameters',
  localInferenceLaunchAdvancedDescription:
    'These model loading parameters are written to the local inference preset. Keep defaults if unsure.',
  localInferenceLaunchNumBatch: 'Batch Size',
  localInferenceLaunchNumBatchHint: 'Prompt processing batch size; lower it when VRAM is tight.',
  localInferenceLaunchUseMmap: 'Memory Mapping',
  localInferenceLaunchUseMmapHint:
    'Written as local inference mmap. Disabled is equivalent to no-mmap.',
  localInferenceLaunchDefault: 'Default',
  localInferenceLaunchBooleanDefault: 'Default',
  localInferenceLaunchBooleanEnabled: 'Enabled',
  localInferenceLaunchBooleanDisabled: 'Disabled',
  localInferenceLaunchLoadOnly: 'Preload',
  localInferenceLaunchLoadAndDebug: 'Start Debugging',
};
