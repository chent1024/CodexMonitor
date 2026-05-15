import type { ApprovalRequest, DebugEntry, RequestUserInputRequest } from "../../../types";
import { useWindowFocusState } from "../../layout/hooks/useWindowFocusState";
import { useAgentResponseRequiredNotifications } from "../../notifications/hooks/useAgentResponseRequiredNotifications";

type Params = {
  systemNotificationsEnabled: boolean;
  notificationSoundsEnabled: boolean;
  notificationSoundUrl: string;
  subagentSystemNotificationsEnabled: boolean;
  isSubagentThread?: (workspaceId: string, threadId: string) => boolean;
  approvals: ApprovalRequest[];
  userInputRequests: RequestUserInputRequest[];
  getWorkspaceName?: (workspaceId: string) => string | undefined;
  getThreadTitle?: (workspaceId: string, threadId: string) => string | undefined;
  onDebug?: (entry: DebugEntry) => void;
};

export function useResponseRequiredNotificationsController({
  systemNotificationsEnabled,
  notificationSoundsEnabled,
  notificationSoundUrl,
  subagentSystemNotificationsEnabled,
  isSubagentThread,
  approvals,
  userInputRequests,
  getWorkspaceName,
  getThreadTitle,
  onDebug,
}: Params) {
  const isWindowFocused = useWindowFocusState();

  useAgentResponseRequiredNotifications({
    enabled: systemNotificationsEnabled,
    notificationSoundsEnabled,
    notificationSoundUrl,
    subagentNotificationsEnabled: subagentSystemNotificationsEnabled,
    isSubagentThread,
    isWindowFocused,
    approvals,
    userInputRequests,
    getWorkspaceName,
    getThreadTitle,
    onDebug,
  });
}
