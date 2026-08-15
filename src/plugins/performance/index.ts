import type { NextDocPlugin } from "../../core/types.js";
import { bundleSize } from "./rules/bundle-size.js";
import { unnecessaryUseClient } from "./rules/unnecessary-use-client.js";
import { imageOptimization } from "./rules/image-optimization.js";
import { uncachedFetch } from "./rules/uncached-fetch.js";
import { duplicateDependencies } from "./rules/duplicate-dependencies.js";
import { fontLoading } from "./rules/font-loading.js";

/**
 * Diagnostic only in v1. Nothing here is safely auto fixable: removing a
 * "use client" directive incorrectly breaks the app at runtime, so --fix is a
 * documented no-op for this plugin rather than a guess.
 */
export const performancePlugin: NextDocPlugin = {
  name: "performance",
  description: "Measures bundle weight and finds rendering and asset choices that cost you speed",
  rules: [bundleSize, unnecessaryUseClient, uncachedFetch, imageOptimization, fontLoading, duplicateDependencies],
};
