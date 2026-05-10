import Link2 from "lucide-react/dist/esm/icons/link-2";
import Plus from "lucide-react/dist/esm/icons/plus";

type HomeActionsProps = {
  onAddWorkspace: () => void;
  onAddWorkspaceFromUrl: () => void;
};

export function HomeActions({
  onAddWorkspace,
  onAddWorkspaceFromUrl,
}: HomeActionsProps) {
  return (
    <div className="home-actions">
      <button
        className="home-button primary home-add-workspaces-button"
        onClick={onAddWorkspace}
        data-tauri-drag-region="false"
      >
        <span className="home-icon" aria-hidden>
          <Plus size={16} strokeWidth={2} />
        </span>
        添加项目
      </button>
      <button
        className="home-button secondary home-add-workspace-from-url-button"
        onClick={onAddWorkspaceFromUrl}
        data-tauri-drag-region="false"
      >
        <span className="home-icon" aria-hidden>
          <Link2 size={16} strokeWidth={2} />
        </span>
        从 URL 添加项目
      </button>
    </div>
  );
}
