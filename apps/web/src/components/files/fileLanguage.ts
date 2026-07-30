import type { SupportedLanguages } from "@pierre/diffs";

/**
 * Languages the renderer cannot infer from a filename.
 *
 * `.env` happens to resolve correctly — its trailing `env` reads as an
 * extension — but every variant (`.env.local`, `.env.production`) resolves to
 * its own suffix instead and falls back to plain text. Naming the language
 * explicitly makes every env file highlight the same way.
 */
export function fileLanguageOverride(path: string): SupportedLanguages | undefined {
  const name = path.split("/").pop() ?? path;
  if (name === ".env" || name.startsWith(".env.")) return "dotenv";
  return undefined;
}

/** Spreadable `lang` field, empty when the filename already resolves correctly. */
export function fileLanguageProps(path: string): { readonly lang?: SupportedLanguages } {
  const lang = fileLanguageOverride(path);
  return lang === undefined ? {} : { lang };
}
