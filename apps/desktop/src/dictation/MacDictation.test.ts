import { assert, describe, it } from "@effect/vitest";

import {
  buildMacDictationScript,
  MAC_DICTATION_ACCESSIBILITY_ERROR,
  parseMacDictationResult,
} from "./MacDictation.ts";

describe("MacDictation", () => {
  it("starts Dictation only when it is not already active", () => {
    const script = buildMacDictationScript('T3 "Code"', true);

    assert.include(script, 'process "T3 \\"Code\\""');
    assert.include(script, 'name contains "Stop Dictation"');
    assert.include(script, 'name contains "Start Dictation"');
    assert.include(script, 'return "active"');
  });

  it("stops Dictation only when it is active", () => {
    const script = buildMacDictationScript("T3 Code", false);

    assert.include(script, 'name contains "Start Dictation"');
    assert.include(script, 'name contains "Stop Dictation"');
    assert.include(script, 'return "inactive"');
  });

  it("parses the native menu result and gives actionable permission guidance", () => {
    assert.isTrue(parseMacDictationResult("active\n"));
    assert.isFalse(parseMacDictationResult("inactive\n"));
    assert.include(MAC_DICTATION_ACCESSIBILITY_ERROR, "Privacy & Security > Accessibility");
  });
});
