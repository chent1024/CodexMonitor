// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ChatPane } from "./ChatPane";

function MessagesProbe({ footerNode }: { footerNode?: ReactNode }) {
  return (
    <section data-testid="messages-probe">
      <div>Messages</div>
      {footerNode ? <div data-testid="messages-footer-probe">{footerNode}</div> : null}
    </section>
  );
}

describe("ChatPane", () => {
  it("injects the composer as the messages footer so widths share one container", () => {
    render(
      <ChatPane
        messagesNode={<MessagesProbe />}
        composerNode={<footer data-testid="composer-probe">Composer</footer>}
      />,
    );

    expect(screen.getByTestId("messages-probe")).toBeTruthy();
    expect(
      screen
        .getByTestId("messages-footer-probe")
        .contains(screen.getByTestId("composer-probe")),
    ).toBe(true);
  });
});
