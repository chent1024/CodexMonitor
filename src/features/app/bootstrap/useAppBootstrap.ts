import { useDebugLog } from "@/features/debug/hooks/useDebugLog";
import { useAppSettingsController } from "@app/hooks/useAppSettingsController";
import { useCodeCssVars } from "@app/hooks/useCodeCssVars";

export function useAppBootstrap() {
  const appSettingsState = useAppSettingsController();
  useCodeCssVars(appSettingsState.appSettings);

  const debugState = useDebugLog();

  return {
    ...appSettingsState,
    ...debugState,
  };
}
