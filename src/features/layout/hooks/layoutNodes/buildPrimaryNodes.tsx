import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import { Sidebar } from "../../../app/components/Sidebar";
import { Home } from "../../../home/components/Home";
import { MainHeader } from "../../../app/components/MainHeader";
import { Messages } from "../../../messages/components/Messages";
import { ApprovalToasts } from "../../../app/components/ApprovalToasts";
import { ErrorToasts } from "../../../notifications/components/ErrorToasts";
import { Composer } from "../../../composer/components/Composer";
import { WorkingIndicator } from "../../../messages/components/MessageRows";
import { getLatestReasoningWorkingLabel } from "../../../messages/utils/messageRenderUtils";
import { TabBar } from "../../../app/components/TabBar";
import { TabletNav } from "../../../app/components/TabletNav";
import type {
  LayoutNodesResult,
  LayoutPrimarySurface,
} from "./types";

export type PrimaryLayoutNodesOptions = LayoutPrimarySurface;

type PrimaryLayoutNodes = Pick<
  LayoutNodesResult,
  | "sidebarNode"
  | "messagesNode"
  | "composerNode"
  | "approvalToastsNode"
  | "errorToastsNode"
  | "homeNode"
  | "mainHeaderNode"
  | "desktopTopbarLeftNode"
  | "tabletNavNode"
  | "tabBarNode"
>;

export function buildPrimaryNodes(options: PrimaryLayoutNodesOptions): PrimaryLayoutNodes {
  const sidebarNode = <Sidebar {...options.sidebarProps} />;
  const hasComposer = Boolean(options.composerProps);
  const hasComposerStatus = options.messagesProps.isThinking;

  const messagesNode = (
    <Messages
      {...options.messagesProps}
      renderActiveWorkingIndicator={!hasComposer}
    />
  );

  const composerNode = options.composerProps ? (
    <>
      {hasComposerStatus ? (
        <div className="chat-pane-composer-status">
          <WorkingIndicator
            isThinking={options.messagesProps.isThinking}
            processingStartedAt={options.messagesProps.processingStartedAt}
            lastDurationMs={null}
            hasItems={options.messagesProps.items.length > 0}
            reasoningLabel={getLatestReasoningWorkingLabel(options.messagesProps.items)}
            showPollingFetchStatus={options.messagesProps.showPollingFetchStatus}
            pollingIntervalMs={options.messagesProps.pollingIntervalMs}
          />
        </div>
      ) : null}
      <Composer {...options.composerProps} />
    </>
  ) : null;

  const approvalToastsNode = <ApprovalToasts {...options.approvalToastsProps} />;

  const errorToastsNode = <ErrorToasts {...options.errorToastsProps} />;

  const homeNode = <Home {...options.homeProps} />;

  const mainHeaderNode = options.mainHeaderProps ? (
    <MainHeader {...options.mainHeaderProps} />
  ) : null;

  const desktopTopbarLeftNode = (
    <>
      {options.desktopTopbarProps.showBackToChat && (
        <button
          className="icon-button back-button"
          onClick={options.desktopTopbarProps.onExitDiff}
          aria-label="Back to chat"
        >
          <ArrowLeft aria-hidden />
        </button>
      )}
      {mainHeaderNode}
    </>
  );

  const tabletNavNode = (
    <TabletNav {...options.tabletNavProps} />
  );

  const tabBarNode = <TabBar {...options.tabBarProps} />;

  return {
    sidebarNode,
    messagesNode,
    composerNode,
    approvalToastsNode,
    errorToastsNode,
    homeNode,
    mainHeaderNode,
    desktopTopbarLeftNode,
    tabletNavNode,
    tabBarNode,
  };
}
