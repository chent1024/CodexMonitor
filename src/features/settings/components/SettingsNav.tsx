import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal";
import Keyboard from "lucide-react/dist/esm/icons/keyboard";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Database from "lucide-react/dist/esm/icons/database";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import FileText from "lucide-react/dist/esm/icons/file-text";
import FlaskConical from "lucide-react/dist/esm/icons/flask-conical";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import Layers from "lucide-react/dist/esm/icons/layers";
import ServerCog from "lucide-react/dist/esm/icons/server-cog";
import Bot from "lucide-react/dist/esm/icons/bot";
import Info from "lucide-react/dist/esm/icons/info";
import type { ReactNode } from "react";
import { PanelNavItem, PanelNavList } from "@/features/design-system/components/panel/PanelPrimitives";
import type { CodexSection } from "./settingsTypes";

type SettingsNavProps = {
  activeSection: CodexSection;
  onSelectSection: (section: CodexSection) => void;
  showDisclosure?: boolean;
};

const NAV_ITEMS: Array<{
  id: CodexSection;
  label: string;
  icon: ReactNode;
}> = [
  { id: "projects", label: "项目", icon: <LayoutGrid aria-hidden /> },
  { id: "environments", label: "环境", icon: <Layers aria-hidden /> },
  { id: "display", label: "显示与声音", icon: <SlidersHorizontal aria-hidden /> },
  { id: "composer", label: "Composer", icon: <FileText aria-hidden /> },
  { id: "shortcuts", label: "快捷键", icon: <Keyboard aria-hidden /> },
  { id: "open-apps", label: "打开应用", icon: <ExternalLink aria-hidden /> },
  { id: "git", label: "Git", icon: <GitBranch aria-hidden /> },
  { id: "index", label: "索引", icon: <Database aria-hidden /> },
  { id: "server", label: "服务器", icon: <ServerCog aria-hidden /> },
  { id: "agents", label: "智能体", icon: <Bot aria-hidden /> },
  { id: "codex", label: "Codex", icon: <TerminalSquare aria-hidden /> },
  { id: "features", label: "功能", icon: <FlaskConical aria-hidden /> },
  { id: "about", label: "关于", icon: <Info aria-hidden /> },
];

export function SettingsNav({
  activeSection,
  onSelectSection,
  showDisclosure = false,
}: SettingsNavProps) {
  return (
    <aside className="settings-sidebar">
      <PanelNavList className="settings-nav-list">
        {NAV_ITEMS.map((item) => (
          <PanelNavItem
            key={item.id}
            className="settings-nav"
            icon={item.icon}
            active={activeSection === item.id}
            showDisclosure={showDisclosure}
            onClick={() => onSelectSection(item.id)}
          >
            {item.label}
          </PanelNavItem>
        ))}
      </PanelNavList>
    </aside>
  );
}
