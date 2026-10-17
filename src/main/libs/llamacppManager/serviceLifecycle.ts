// Service layer marker class (#1069); lifecycle lives on LlamaCppManagerCore.
import { LlamaCppManagerBackendOps } from './backendOps';

export class LlamaCppManagerService extends LlamaCppManagerBackendOps {}
