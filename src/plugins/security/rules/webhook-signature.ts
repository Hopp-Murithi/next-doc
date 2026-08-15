import type { Finding, Rule, ScanContext } from "../../../core/types.js";
import { finding } from "../../../core/plugin.js";

const WEBHOOK_PATH = /(^|\/)(webhooks?)(\/|\.|-|_)|(^|\/)webhook/i;

/** Signature verification shapes for the providers people actually integrate. */
const VERIFICATION_PATTERNS = [
  /webhooks\.constructEvent/, // Stripe
  /constructEventAsync/, // Stripe edge runtime
  /timingSafeEqual/, // generic HMAC comparison
  /createHmac/, // generic HMAC
  /verifyHeader/, // Svix, Clerk
  /new\s+Webhook\s*\(/, // Svix
  /verifySignature/,
  /verifyWebhook/,
  /validateSignature/,
  /verifyPaddleSignature/,
  /subtle\.verify/,
  /verifyRequestSignature/,
];

const SIGNATURE_HEADERS = [
  /stripe-signature/i,
  /x-hub-signature/i,
  /x-signature/i,
  /svix-signature/i,
  /paypal-transmission-sig/i,
  /x-paddle-signature/i,
  /x-shopify-hmac/i,
];

export const webhookSignature: Rule = {
  code: "SECURITY_WEBHOOK_UNVERIFIED",
  title: "Webhook handlers verify signatures",
  async run(ctx: ScanContext): Promise<Finding[]> {
    const sources = await ctx.files.sources();
    const webhookFiles = sources.filter((s) => WEBHOOK_PATH.test(s.path) && !s.isClient);
    if (webhookFiles.length === 0) return [];

    const findings: Finding[] = [];

    for (const file of webhookFiles) {
      const verified =
        VERIFICATION_PATTERNS.some((re) => re.test(file.text)) ||
        SIGNATURE_HEADERS.some((re) => re.test(file.text));
      if (verified) continue;

      findings.push(
        finding.error({
          code: "SECURITY_WEBHOOK_UNVERIFIED",
          message: `${file.path} handles webhooks with no signature verification detected`,
          file: file.path,
          line: 1,
          fixable: false,
          suggestion:
            "Verify the provider signature before trusting the payload, for example stripe.webhooks.constructEvent with the raw body, or an HMAC compared with crypto.timingSafeEqual. Without it anyone who learns the URL can post fake events.",
        }),
      );
    }

    if (findings.length === 0) {
      return [
        finding.pass({
          code: "SECURITY_WEBHOOK_UNVERIFIED",
          message: `All ${webhookFiles.length} webhook handler${webhookFiles.length === 1 ? "" : "s"} verify signatures`,
        }),
      ];
    }

    return findings;
  },
};
