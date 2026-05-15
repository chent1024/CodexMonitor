import { useEffect, useState } from "react";
import { getAppBuildType, type AppBuildType } from "@services/tauri";
import { SettingsSection } from "@/features/design-system/components/settings/SettingsPrimitives";

export function SettingsAboutSection() {
  const [appBuildType, setAppBuildType] = useState<AppBuildType | "unknown">("unknown");

  useEffect(() => {
    let active = true;
    const loadBuildType = async () => {
      try {
        const value = await getAppBuildType();
        if (active) {
          setAppBuildType(value);
        }
      } catch {
        if (active) {
          setAppBuildType("unknown");
        }
      }
    };
    void loadBuildType();
    return () => {
      active = false;
    };
  }, []);

  const buildDateValue = __APP_BUILD_DATE__.trim();
  const parsedBuildDate = Date.parse(buildDateValue);
  const buildDateLabel = Number.isNaN(parsedBuildDate)
    ? buildDateValue || "unknown"
    : new Date(parsedBuildDate).toLocaleString();

  return (
    <SettingsSection title="关于" subtitle="应用版本和构建信息。">
      <div className="settings-field">
        <div className="settings-help">
          版本：<code>{__APP_VERSION__}</code>
        </div>
        <div className="settings-help">
          构建类型：<code>{appBuildType}</code>
        </div>
        <div className="settings-help">
          分支：<code>{__APP_GIT_BRANCH__ || "unknown"}</code>
        </div>
        <div className="settings-help">
          提交：<code>{__APP_COMMIT_HASH__ || "unknown"}</code>
        </div>
        <div className="settings-help">
          构建时间：<code>{buildDateLabel}</code>
        </div>
      </div>
    </SettingsSection>
  );
}
