export const enMain2 = {
  coworkErrorGatewayDraining: 'AI engine is restarting. Please wait a moment and try again.',
  coworkErrorNetworkError: 'Network connection failed. Please check your network settings.',
  coworkErrorRateLimit: 'Too many requests. Please try again later.',
  coworkErrorContentFiltered:
    'Content did not pass the safety review. Please modify and try again.',
  coworkErrorServerError: 'Server error occurred. Please try again later.',
  coworkErrorEngineNotReady: 'AI engine is starting up. Please wait a few seconds and try again.',
  coworkLlamaCppModelNotRunning:
    'This local inference model is not running. Load it from Local Inference first or choose another model.',
  coworkLlamaCppContextWindowUnknown:
    'The running local inference model did not report an effective context window. Reload it from Local Inference before sending again.',
  coworkLlamaCppContextWindowTooSmall:
    'This local inference model is currently running with too small a context window ({current}); Agent engine requires at least {required}. Increase ctx-size and reload the model.',
  coworkLlamaCppTrainingContextTooSmall:
    "This local inference model was trained for only {trained} context tokens, below Agent engine's minimum requirement of {required}. Choose a larger-context model for agent and scheduled-task use.",
  coworkLocalModelToolCallingUnsupported:
    'The selected local model does not support tool calling and cannot run Work mode. Choose a model with tool-calling support.',
  coworkLocalModelToolCallingUnknown:
    'The selected local model has unknown tool-calling support. Detect or configure it before running Work mode.',
  coworkLlamaCppContextLimitReached:
    'This local inference session is already near its context limit ({used} / {limit} tokens). Start a new session (/new) or switch to a larger-context model.',
  llamacppUnloadVramRecoveryPending:
    'The model has been removed from the local inference running list, but VRAM may still be reclaiming. Wait a moment before checking again.',
  llamacppUnloadConfirmationPending:
    'The unload request was sent, but the app has not yet confirmed that the model fully disappeared from the running list. Wait a few seconds and check again.',
  llamacppLaunchContextExceedsTrainingLimit:
    'The requested load context {requested} exceeds the model training limit {trained}. Lower ctx-size before loading the model.',
  llamacppCudaBackendFallbackCpu:
    'The CUDA backend install or validation failed, so ZhiYuan Agent switched to the CPU llama.cpp runtime automatically. Choose a CUDA backend manually in Local Inference → Runtime if needed.',
  llamacppCudaBackendFallbackCpuDriver:
    'The selected CUDA runtime may be incompatible with the installed NVIDIA driver. ZhiYuan Agent switched to the CPU llama.cpp runtime automatically. Upgrade the driver or switch between CUDA 12/13 backends and retry.',
  llamacppCudaEditionUnsupportedGpu:
    'This GPU reports compute capability {capability}. The CUDA edition requires {required} (RTX 40 series). Install the CPU edition of ZhiYuan Agent or use a compatible GPU.',
  llamacppLaunchContextClampedToTrainingLimit:
    'The requested context {requested} exceeds the model training limit {trained}. Started with {effective} instead.',
  llamacppLoadModelLimitReached: 'The model limit has been reached. Unload a model and try again.',
  llamacppLoadModelGpuNotFound:
    'No available GPU was detected. Check your GPU driver or CUDA environment and try again.',
  llamacppLoadModelGpuProbeFailed:
    'GPU environment detection failed. Check your GPU driver or CUDA environment and try again.',
  llamacppLoadModelVramInsufficient:
    'Insufficient VRAM. Check available VRAM or unload models and try again.',
  llamacppLoadModelSystemMemoryInsufficient:
    'Insufficient system memory. Close other applications and try again.',
  llamacppLoadModelContextTooLarge:
    'The model context is too large. The system lowered the configuration but still could not load it.',
  llamacppLoadModelFileInvalid: 'The model file is invalid. Download or import the model again.',
  llamacppLoadModelNotFound: 'The model file was not found. Download or import the model again.',
  llamacppLoadModelServiceUnavailable:
    'The local inference service is unavailable. Please try again later.',
  llamacppLoadModelStartupTimeout:
    'Model loading took too long. Try again later or lower the model configuration.',
  llamacppModelLoadCancelled: 'Model startup was cancelled.',
  llamacppLoadModelUnknown: 'Model loading failed. Please try again later.',
  llamacppModelLoadInProgress: 'A model is already loading. Wait for it to finish and try again.',
  llamacppServiceStartupPortInUse:
    'The local inference service port is already in use. Check the port setting or close the conflicting process and try again.',
  llamacppServiceStartupProcessExited:
    'The local inference service exited during startup. Please try again later.',
  llamacppServiceStartupTimeout:
    'The local inference service startup timed out. Please try again later.',
  llamacppServiceStartupBackendUnavailable:
    'The selected local inference runtime backend is unavailable. Check the GPU driver or runtime configuration.',
  llamacppServiceStartupRuntimeDamaged:
    'The local inference runtime is unavailable or may be damaged. Reinstall the application and try again.',
  llamacppServiceStartupUnknown:
    'The local inference service failed to start. Please try again later.',
  llamacppModelLaunchLogWindowTitle: 'Model startup logs',
  localInferenceImportRuntimeDialogTitle: 'Select local inference Backend',
  localInferenceImportRuntimeDialogMessage:
    'Select a local inference backend archive (zip or tar.gz). If it is already extracted, open that directory and choose any file inside it. ZhiYuan Agent will validate the platform and backend type before importing it.',
  coworkErrorUnknown:
    'Task failed due to an unexpected error. Please retry. If the issue persists, check your model configuration.',
  imErrorPrefix: 'Error processing message',
  // IM error replies (differentiated by error kind)
  imErrorAuthExpired:
    'AI assistant authentication expired. Please open the app to update your API key.',
  imErrorRateLimited: 'AI assistant is receiving too many requests. Please try again later.',
  imErrorBudgetExceeded: 'AI assistant account balance insufficient. Please top up and try again.',
  imErrorEngineNotReady: 'AI engine is starting up. Please wait and try again.',
  imErrorTransient:
    'AI assistant temporarily unavailable ({error}). Automatically recovering, please try later.',
  imErrorContentFiltered:
    'Message content did not pass safety review. Please revise and try again.',
  imErrorInputTooLong: 'Message content too long. Please shorten and try again.',
  imErrorExecutionLimit: 'Task timed out or reached limit. Please simplify and try again.',
  imErrorModelCapabilityUnsupported:
    'The current model does not support this input modality (e.g. images). Please switch models or check the model configuration, then try again.',
  imErrorProviderUnavailable:
    'The model service used by this session is disabled or unavailable. Please check the model configuration in the app and try again.',
  imErrorStreamInterrupted:
    'The connection to the model was interrupted and this task was stopped. Please send your message again.',
  imErrorUnknown: 'Error processing message: {error}. Please try again.',

  // Image input fallback (see libs/agentEngine/piImageInputFallback.ts)
  coworkImageNotSentNotice:
    'This message included an image, but it was not sent to the model. The model received the image file path and will try local tools to read any text in it. If the model supports images, you can enable image input in the model settings.',
  coworkImageRetryNotice:
    'This model refused the image payload, so the request was retried as text only.',

  // Exec approval continuation
  execApprovalApproved:
    'The user approved the command execution. Please check the result and continue.',
  execApprovalDenied: 'The user denied the command execution.',

  // Skill manager errors
  skillErrNoSkillMd: 'No SKILL.md found in source',
  skillErrInvalidSource:
    'Invalid skill source. Use owner/repo, repo URL, npm package spec, a ModelScope skill URL, or a GitHub tree/blob URL.',
  skillErrModelScopeInstallUnavailable:
    'This ModelScope skill does not provide an installable source or archive. Check its ModelScope page for installation instructions.',
  skillErrAlreadyInstalled:
    'Skill {name} is already installed. Remove the existing version and try again.',

  // Gateway startup phases
  gatewayStartupPrecompiling: 'Pre-compiling gateway bundle...',
  gatewayStartupCompiling: 'Compiling gateway bundle...',
  gatewayStartupLoadingModules: 'Loading gateway modules...',
  gatewayStartupStarting: 'Starting AI engine...',

  // Auth quota
  authPlanFree: 'Free',
  authPlanStandard: 'Standard',

  // ── IM connectivity test messages ───────────────────────────────────
  // Common
  imMissingCredentials: 'Missing required configuration: {fields}',
  imFillCredentials: 'Please complete the configuration and test connectivity again.',
  imAuthProbeTimeout: 'Authentication probe timed out',
  imAuthFailed: 'Authentication failed: {error}',
  imAuthFailedSuggestion:
    'Please check that your ID/Secret/Token are correct and that bot permissions are enabled.',
  imWeixinReconnectRequired: 'Reconnect the Weixin channel before it can receive messages.',
  imChannelEnabledNotConnected: 'IM channel is enabled but not currently connected.',
};
