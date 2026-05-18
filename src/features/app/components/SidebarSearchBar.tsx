import X from "lucide-react/dist/esm/icons/x";
import Database from "lucide-react/dist/esm/icons/database";
import Download from "lucide-react/dist/esm/icons/download";

type SidebarSearchBarProps = {
  isSearchOpen: boolean;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onClearSearch: () => void;
  onRebuildIndexFromCodexSessions: () => void;
  onRebuildIndexFromAppServer: () => void;
  indexRebuildInProgress?: boolean;
};

export function SidebarSearchBar({
  isSearchOpen,
  searchQuery,
  onSearchQueryChange,
  onClearSearch,
  onRebuildIndexFromCodexSessions,
  onRebuildIndexFromAppServer,
  indexRebuildInProgress = false,
}: SidebarSearchBarProps) {
  return (
    <div className={`sidebar-search${isSearchOpen ? " is-open" : ""}`}>
      {isSearchOpen && (
        <input
          className="sidebar-search-input"
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="搜索会话"
          aria-label="搜索会话"
          data-tauri-drag-region="false"
          autoFocus
        />
      )}
      {isSearchOpen && (
        <button
          type="button"
          className="sidebar-search-index"
          onClick={onRebuildIndexFromCodexSessions}
          aria-label="从 .codex sessions 建立索引"
          title={indexRebuildInProgress ? "正在建立索引" : "从 .codex sessions 建立索引"}
          data-tauri-drag-region="false"
          disabled={indexRebuildInProgress}
        >
          <Database size={12} aria-hidden />
        </button>
      )}
      {isSearchOpen && (
        <button
          type="button"
          className="sidebar-search-pull-index"
          onClick={onRebuildIndexFromAppServer}
          aria-label="从已连接项目拉取历史建立索引"
          title={indexRebuildInProgress ? "正在建立索引" : "从已连接项目拉取历史建立索引"}
          data-tauri-drag-region="false"
          disabled={indexRebuildInProgress}
        >
          <Download size={12} aria-hidden />
        </button>
      )}
      {isSearchOpen && searchQuery.length > 0 && (
        <button
          type="button"
          className="sidebar-search-clear"
          onClick={onClearSearch}
          aria-label="清除搜索"
          data-tauri-drag-region="false"
        >
          <X size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}
