import { PROVIDER_DISPLAY_NAMES, type ProviderDriverKind } from "@t3tools/contracts";

const USAGE_LIMIT_PATTERNS: ReadonlyArray<RegExp> = [
  /\busage[\s_-]*limit(?:\s+(?:has\s+been\s+)?reached)?\b/i,
  /\brate[\s_-]*limit(?:ed|[\s_-]*(?:(?:has[\s_-]+been[\s_-]+)?(?:reached|exceeded)))?\b/i,
  /\bquota(?:\s+(?:has\s+been\s+)?)?(?:reached|exceeded|exhausted|depleted)\b/i,
  /\b(?:insufficient|no)\s+(?:credits?|quota)\b/i,
  /\bcredits?\s+(?:reached|exceeded|exhausted|depleted)\b/i,
  /\btoo\s+many\s+requests\b/i,
  /\bresource[\s_-]*exhausted\b/i,
  /(?:^|\D)429(?:\D|$)/,
];

function displayName(provider: ProviderDriverKind): string {
  return PROVIDER_DISPLAY_NAMES[provider] ?? String(provider);
}

export function isProviderUsageLimitFailure(detail: string): boolean {
  return USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(detail));
}

export function presentProviderFailure(provider: ProviderDriverKind, detail: string): string {
  const normalized = detail.trim();
  if (!isProviderUsageLimitFailure(normalized)) {
    return normalized || `${displayName(provider)} request failed.`;
  }

  const name = displayName(provider);
  return `${name} usage limit reached. Check your ${name} plan or wait for the limit to reset, then try again.`;
}

/**
 * Kimi Code CLI 0.29 returns a successful ACP `end_turn` with no events when
 * the account has exhausted its usage allowance. Other ACP providers receive
 * a truthful no-response failure instead of being incorrectly labelled as a
 * quota failure.
 */
export function presentEmptyAcpTurnFailure(provider: ProviderDriverKind): string {
  const name = displayName(provider);
  if (String(provider) === "kimi") {
    return `${name} usage limit reached. Kimi returned an empty turn; check your ${name} plan or wait for the limit to reset, then try again.`;
  }
  return `${name} ended the turn without returning a response. Try again or check the provider account status.`;
}
