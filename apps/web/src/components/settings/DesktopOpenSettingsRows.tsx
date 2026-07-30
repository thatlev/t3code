import { useEffect, useState } from "react";

import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";

export function DesktopOpenSettingsRows() {
  const [remoteAccessEnabled, setRemoteAccessEnabledState] = useState(true);
  const [remoteAccessBusy, setRemoteAccessBusy] = useState(false);
  const [keepMacAwake, setKeepMacAwakeState] = useState(false);
  const [keepMacAwakeBusy, setKeepMacAwakeBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void window.desktopBridge?.getRemoteAccessEnabled().then((enabled) => {
      if (active) setRemoteAccessEnabledState(enabled);
    });
    void window.desktopBridge?.getKeepMacAwake().then((enabled) => {
      if (active) setKeepMacAwakeState(enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <SettingsRow
        title="Enable remote access while T3 Code is open"
        description="Keeps this Mac reachable from your authenticated T3 Code devices without running t3 serve."
        control={
          <Switch
            aria-label="Enable remote access while T3 Code is open"
            checked={remoteAccessEnabled}
            disabled={remoteAccessBusy}
            onCheckedChange={(enabled) => {
              setRemoteAccessBusy(true);
              void window.desktopBridge
                ?.setRemoteAccessEnabled(enabled)
                .then(setRemoteAccessEnabledState)
                .finally(() => setRemoteAccessBusy(false));
            }}
          />
        }
      />
      <SettingsRow
        title="Keep Mac awake while T3 Code is open"
        description="Prevents idle system sleep while allowing the display to sleep."
        control={
          <Switch
            aria-label="Keep Mac awake while T3 Code is open"
            checked={keepMacAwake}
            disabled={keepMacAwakeBusy}
            onCheckedChange={(enabled) => {
              setKeepMacAwakeBusy(true);
              void window.desktopBridge
                ?.setKeepMacAwake(enabled)
                .then(setKeepMacAwakeState)
                .finally(() => setKeepMacAwakeBusy(false));
            }}
          />
        }
      />
    </>
  );
}
