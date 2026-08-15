import type { NextDocPlugin } from "../../core/types.js";
import { publicSecretLeakRule } from "../shared/public-secret-leak.js";
import { missingRequiredVars, missingUsedVars } from "./rules/missing-vars.js";
import { unusedVars } from "./rules/unused-vars.js";
import { typeMismatch } from "./rules/type-mismatch.js";
import { envFileDrift, secretInExample } from "./rules/env-file-drift.js";

export const envPlugin: NextDocPlugin = {
  name: "env",
  description: "Validates environment variables across your code, your .env files and your template",
  rules: [
    missingRequiredVars,
    missingUsedVars,
    publicSecretLeakRule("ENV_PUBLIC_SECRET"),
    secretInExample,
    typeMismatch,
    envFileDrift,
    unusedVars,
  ],
};
