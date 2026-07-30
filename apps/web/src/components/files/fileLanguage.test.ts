import { describe, expect, it } from "vite-plus/test";

import { fileLanguageOverride, fileLanguageProps } from "./fileLanguage";

describe("file language overrides", () => {
  it("names dotenv for every env variant", () => {
    expect(fileLanguageOverride(".env")).toBe("dotenv");
    expect(fileLanguageOverride("apps/web/.env")).toBe("dotenv");
    expect(fileLanguageOverride("apps/web/.env.local")).toBe("dotenv");
    expect(fileLanguageOverride(".env.production.local")).toBe("dotenv");
  });

  it("leaves files the renderer already resolves alone", () => {
    expect(fileLanguageOverride("src/main.ts")).toBeUndefined();
    expect(fileLanguageOverride("README.md")).toBeUndefined();
    // Not env files despite the substring.
    expect(fileLanguageOverride("config/env")).toBeUndefined();
    expect(fileLanguageOverride(".environment")).toBeUndefined();
    expect(fileLanguageOverride("app.env")).toBeUndefined();
  });

  it("spreads nothing when there is no override", () => {
    expect(fileLanguageProps("src/main.ts")).toEqual({});
    expect(fileLanguageProps(".env.local")).toEqual({ lang: "dotenv" });
  });
});
