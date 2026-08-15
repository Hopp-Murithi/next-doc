/**
 * Shared secret heuristics. Used by both the env plugin and the security
 * plugin, imported rather than duplicated so the two can never drift.
 *
 * Rule of the house: this module reasons about variable NAMES and value SHAPES.
 * It never returns, logs, or embeds a secret value.
 */

const SECRET_WORDS = [
  "SECRET",
  "PRIVATE",
  "PASSWORD",
  "PASSWD",
  "TOKEN",
  "API_KEY",
  "APIKEY",
  "ACCESS_KEY",
  "CLIENT_SECRET",
  "CREDENTIAL",
  "SIGNING",
  "SALT",
  "SESSION_KEY",
];

/** Names that contain a secret word but are safe by convention. */
const PUBLIC_SAFE_NAME_HINTS = ["PUBLISHABLE", "PUBLIC_KEY", "SITE_KEY", "CLIENT_ID", "ANON_KEY"];

/** Value shapes that are published on purpose by their vendor. */
const PUBLISHABLE_VALUE_PATTERNS: RegExp[] = [
  /^pk_(test|live)_[A-Za-z0-9]+$/, // Stripe publishable key
  /^pk\.[A-Za-z0-9._-]+$/, // Mapbox public token
  /^G-[A-Z0-9]{6,}$/, // Google Analytics measurement id
  /^UA-\d{4,}-\d+$/, // Google Analytics legacy id
  /^phc_[A-Za-z0-9]{20,}$/, // PostHog project key
  /^6L[A-Za-z0-9_-]{20,}$/, // reCAPTCHA site key
];

/** Value shapes that are unambiguously private. */
const SECRET_VALUE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "Stripe secret key", re: /\bsk_(test|live)_[A-Za-z0-9]{16,}\b/ },
  { label: "Stripe restricted key", re: /\brk_(test|live)_[A-Za-z0-9]{16,}\b/ },
  { label: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { label: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { label: "OpenAI API key", re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { label: "Anthropic API key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { label: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { label: "Google API key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { label: "Private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { label: "JSON web token", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { label: "Database connection string with password", re: /\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|rediss):\/\/[^\s:@/]+:[^\s:@/]+@/ },
];

export function isPublicName(name: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => name.startsWith(prefix));
}

/** True when the name reads like a private credential. */
export function looksLikeSecretName(name: string): boolean {
  const upper = name.toUpperCase();
  if (PUBLIC_SAFE_NAME_HINTS.some((hint) => upper.includes(hint))) return false;
  if (/(^|_)KEY(_|$)/.test(upper)) return true;
  return SECRET_WORDS.some((word) => upper.includes(word));
}

/** True when the value matches a vendor's documented public key format. */
export function looksLikePublishableValue(value: string): boolean {
  return PUBLISHABLE_VALUE_PATTERNS.some((re) => re.test(value.trim()));
}

/** Identifies the kind of credential a value looks like, without echoing it. */
export function classifySecretValue(value: string): string | null {
  if (looksLikePublishableValue(value)) return null;
  for (const { label, re } of SECRET_VALUE_PATTERNS) {
    if (re.test(value)) return label;
  }
  return null;
}

/** Scans arbitrary text for hardcoded credentials, returning labels and offsets. */
export function findSecretsInText(text: string): Array<{ label: string; index: number }> {
  const hits: Array<{ label: string; index: number }> = [];
  for (const { label, re } of SECRET_VALUE_PATTERNS) {
    const rx = new RegExp(re.source, `${re.flags.replace("g", "")}g`);
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      if (looksLikePublishableValue(m[0])) continue;
      hits.push({ label, index: m.index });
      if (m.index === rx.lastIndex) rx.lastIndex++;
    }
  }
  return hits;
}

/**
 * Last line of defence for report output. Never used to "show a bit of" a
 * secret, only to describe one.
 */
export function redact(value: string): string {
  if (value.length <= 4) return "****";
  return `${"*".repeat(8)} (${value.length} chars)`;
}
