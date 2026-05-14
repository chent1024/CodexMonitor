import { useEffect, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import Maximize2 from "lucide-react/dist/esm/icons/maximize-2";
import Minimize2 from "lucide-react/dist/esm/icons/minimize-2";
import SquareTerminal from "lucide-react/dist/esm/icons/square-terminal";
import type { TerminalTab } from "../hooks/useTerminalTabs";

type TerminalDockProps = {
  isOpen: boolean;
  terminals: TerminalTab[];
  activeTerminalId: string | null;
  onSelectTerminal: (terminalId: string) => void;
  onNewTerminal: () => void;
  onCloseTerminal: (terminalId: string) => void;
  onResizeStart?: (event: ReactMouseEvent) => void;
  terminalNode: ReactNode;
};

export function TerminalDock({
  isOpen,
  terminals,
  activeTerminalId,
  onSelectTerminal,
  onNewTerminal,
  onCloseTerminal,
  onResizeStart,
  terminalNode,
}: TerminalDockProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsFullscreen(false);
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  return (
    <section className={`terminal-panel${isFullscreen ? " is-fullscreen" : ""}`}>
      {onResizeStart && !isFullscreen && (
        <div
          className="terminal-panel-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal panel"
          onMouseDown={onResizeStart}
        />
      )}
      <div className="terminal-header">
        <div className="terminal-tabs" role="tablist" aria-label="Terminal tabs">
          {terminals.map((tab) => (
            <button
              key={tab.id}
              className={`terminal-tab${
                tab.id === activeTerminalId ? " active" : ""
              }`}
              type="button"
              role="tab"
              aria-selected={tab.id === activeTerminalId}
              onClick={() => onSelectTerminal(tab.id)}
            >
              <SquareTerminal
                className="terminal-tab-icon"
                size={18}
                strokeWidth={2}
                aria-hidden
              />
              <span className="terminal-tab-label">{tab.title}</span>
              <span
                className="terminal-tab-close"
                role="button"
                aria-label={`Close ${tab.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onCloseTerminal(tab.id);
                }}
              >
                ×
              </span>
            </button>
          ))}
          <button
            className="terminal-tab-add"
            type="button"
            onClick={onNewTerminal}
            aria-label="New terminal"
            title="New terminal"
          >
            +
          </button>
        </div>
        <div className="terminal-header-actions">
          <button
            type="button"
            className="terminal-header-action"
            onClick={() => setIsFullscreen((current) => !current)}
            aria-label={
              isFullscreen ? "Exit terminal fullscreen" : "Enter terminal fullscreen"
            }
            title={isFullscreen ? "退出全屏" : "全屏"}
          >
            {isFullscreen ? (
              <Minimize2
                className="terminal-header-action-icon"
                size={16}
                strokeWidth={2.4}
                aria-hidden
              />
            ) : (
              <Maximize2
                className="terminal-header-action-icon"
                size={16}
                strokeWidth={2.4}
                aria-hidden
              />
            )}
          </button>
        </div>
      </div>
      <div className="terminal-body">{terminalNode}</div>
    </section>
  );
}
