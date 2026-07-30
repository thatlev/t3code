export const MAC_DICTATION_ACCESSIBILITY_ERROR =
  "Allow T3 Code in System Settings > Privacy & Security > Accessibility, then try Dictation again.";

function appleScriptString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function buildMacDictationScript(appName: string, requestedActive: boolean): string {
  const requestedItem = requestedActive ? "Start Dictation" : "Stop Dictation";
  const existingItem = requestedActive ? "Stop Dictation" : "Start Dictation";
  const result = requestedActive ? "active" : "inactive";

  return `
tell application "System Events"
  tell process ${appleScriptString(appName)}
    set frontmost to true
    tell menu "Edit" of menu bar item "Edit" of menu bar 1
      set existingItems to every menu item whose name contains ${appleScriptString(existingItem)}
      if (count of existingItems) > 0 then return ${appleScriptString(result)}
      set requestedItems to every menu item whose name contains ${appleScriptString(requestedItem)}
      if (count of requestedItems) is 0 then error "T3 Code has no ${requestedItem} menu item"
      click item 1 of requestedItems
      return ${appleScriptString(result)}
    end tell
  end tell
end tell`;
}

export function parseMacDictationResult(value: string): boolean {
  return value.trim() === "active";
}
