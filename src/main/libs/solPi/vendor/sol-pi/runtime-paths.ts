/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: MIT
 */
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Per-session runtime root for all SoL-Pi state.
 *
 * The root derives from the persistent Pi session directory only. An earlier
 * revision also appended the Pi session id, but that id changes on every
 * incarnation of the in-memory session manager, so each stop/continue/rebuild
 * re-archived identical content into a brand-new subtree. Objects are content
 * addressed, so a root that is stable for the session directory deduplicates
 * them across incarnations instead of duplicating the archived bytes.
 */
export function runtimeRoot(ctx: ExtensionContext): string {
	const sessionDir = ctx.sessionManager.getSessionDir();
	if (!sessionDir) throw new Error("SoL-Pi requires a persistent Pi session directory");
	return join(sessionDir, "sol-pi");
}
