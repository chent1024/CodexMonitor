import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

type ChatPaneProps = {
  messagesNode: ReactNode;
  composerNode: ReactNode;
  className?: string;
};

export function ChatPane({ messagesNode, composerNode, className }: ChatPaneProps) {
  const messagesWithFooter =
    composerNode && isValidElement(messagesNode)
      ? cloneElement(
          messagesNode as ReactElement<{ footerNode?: ReactNode }>,
          { footerNode: composerNode },
        )
      : messagesNode;

  return (
    <div className={`chat-pane${className ? ` ${className}` : ""}`}>
      <div className="chat-pane-messages">{messagesWithFooter}</div>
    </div>
  );
}
