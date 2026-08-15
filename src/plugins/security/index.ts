import type { NextDocPlugin } from "../../core/types.js";
import { publicSecretLeakRule } from "../shared/public-secret-leak.js";
import { securityHeaders } from "./rules/security-headers.js";
import { contentSecurityPolicy } from "./rules/csp.js";
import { webhookSignature } from "./rules/webhook-signature.js";
import { csrfProtection } from "./rules/csrf.js";
import { unsafeRedirect } from "./rules/unsafe-redirect.js";
import { serverOnlyInClient } from "./rules/server-only-in-client.js";
import { hardcodedSecret } from "./rules/hardcoded-secret.js";

export const securityPlugin: NextDocPlugin = {
  name: "security",
  description: "Audits response headers, secret exposure and the client server boundary",
  rules: [
    securityHeaders,
    contentSecurityPolicy,
    publicSecretLeakRule("SECURITY_PUBLIC_SECRET"),
    hardcodedSecret,
    serverOnlyInClient,
    webhookSignature,
    csrfProtection,
    unsafeRedirect,
  ],
};
