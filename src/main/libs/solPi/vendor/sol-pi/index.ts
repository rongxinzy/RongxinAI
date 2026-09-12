/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */

import {
	getAgentDir,
	type BashToolOptions,
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { loadSolPiConfig, type SolPiConfig } from "./config.ts";
import { registerActionFusion } from "./extensions/action-fusion/index.ts";
import { registerEvidencePreservingReducer } from "./extensions/evidence-preserving-reducer/index.ts";
import { registerObservationPack } from "./extensions/observation-pack/index.ts";
import { registerOnlineContextCompact } from "./extensions/online-context-compact/index.ts";

/** Runtime-wide knobs the embedding app can pass into the SoL-Pi extension. */
export interface SolPiRuntimeOptions {
	/** Archived-bytes ceiling per session for the observation pack. */
	readonly archiveBudgetBytes?: number;
	/** Bash overrides forwarded to Action Fusion's fused follow-up commands. */
	readonly bashOptions?: BashToolOptions;
}

export function registerConfiguredFeatures(
	pi: ExtensionAPI,
	config: SolPiConfig,
	options: SolPiRuntimeOptions = {},
): void {
	if (config.actionFusion) registerActionFusion(pi, { bashOptions: options.bashOptions });
	if (config.observationPack) registerObservationPack(pi, { archiveBudgetBytes: options.archiveBudgetBytes });
	if (config.evidencePreservingReducer) {
		registerEvidencePreservingReducer(pi, {
			reducerModel: config.evidencePreservingReducerModel,
			reducerProvider: config.evidencePreservingReducerProvider,
		});
	}
	if (config.onlineContextCompact) registerOnlineContextCompact(pi, config.cacheWriteReadRatio);
}

export type SolPiConfigLoader = (ctx: ExtensionContext) => SolPiConfig;

export function createSolPiExtension(
	loadConfig: SolPiConfigLoader = (ctx) => loadSolPiConfig(ctx.cwd, getAgentDir(), ctx.isProjectTrusted()),
	options: SolPiRuntimeOptions = {},
): ExtensionFactory {
	return (pi) => {
		let initialized = false;
		pi.on("session_start", (_event, ctx) => {
			if (initialized) return;
			initialized = true;
			registerConfiguredFeatures(pi, loadConfig(ctx), options);
		});
	};
}

export default function solPiExtension(pi: ExtensionAPI): void {
	createSolPiExtension()(pi);
}
