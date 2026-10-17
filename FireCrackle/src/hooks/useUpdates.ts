import { useEffect, useRef, useState } from "react";
import { version as localVersion } from "../../package.json";
import type { Backend } from "../lib/api";
import { memoryStorage } from "../lib/scopedStorage";
import type { InstallKind } from "../lib/updateCheck";
import { bannerRelease, createUpdateController, type UpdateController } from "../lib/updateController";

function storage(): Pick<Storage, "getItem" | "setItem"> {
  try {
    return window.localStorage;
  } catch {
    return memoryStorage(); // blocked storage: settings last until the app closes
  }
}

async function openInBrowser(url: string): Promise<void> {
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer"); // the browser preview has no desktop shell
  }
}

/** The update check for the app: the controller's state, redrawn when it changes. Does nothing in the browser preview. */
export function useUpdates(backend: Backend | null) {
  const ref = useRef<UpdateController | null>(null);
  if (ref.current === null) ref.current = createUpdateController({ storage: storage(), localVersion, openUrl: openInBrowser });
  const controller = ref.current;
  const [, redraw] = useState(0);
  useEffect(() => controller.subscribe(() => redraw(n => n + 1)), [controller]);
  useEffect(() => {
    if (!backend || backend.mock) return;
    let live = true;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke<InstallKind>("install_kind"))
      .then(kind => { if (live) controller.setKind(kind); })
      .catch(() => { /* the kind stays unknown: the banner then offers every installer */ });
    controller.start();
    return () => { live = false; controller.stop(); };
  }, [backend, controller]);
  return { state: controller.state, banner: bannerRelease(controller.state), controller };
}
