import { readGlobalCodexConfigToml, writeGlobalCodexConfigToml } from "@services/tauri";
import { useFileEditor } from "@/features/shared/hooks/useFileEditor";

export function useGlobalCodexConfigToml({
  enabled = true,
}: { enabled?: boolean } = {}) {
  return useFileEditor({
    key: enabled ? "global-config" : null,
    read: readGlobalCodexConfigToml,
    write: writeGlobalCodexConfigToml,
    readErrorTitle: "Couldn’t load global config.toml",
    writeErrorTitle: "Couldn’t save global config.toml",
    toastOnReadError: false,
  });
}
