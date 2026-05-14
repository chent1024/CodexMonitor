/** @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueuedMessage } from "../../../types";
import { ComposerQueue } from "./ComposerQueue";

const queuedItem: QueuedMessage = {
  id: "queued-1",
  text: "Add link to GitHub repo too",
  createdAt: 1,
};

describe("ComposerQueue", () => {
  afterEach(() => {
    cleanup();
  });

  it("calls edit callback from the inline edit action", () => {
    const onEditQueued = vi.fn();
    render(<ComposerQueue queuedMessages={[queuedItem]} onEditQueued={onEditQueued} />);

    fireEvent.click(screen.getByLabelText("Edit queued message"));

    expect(onEditQueued).toHaveBeenCalledTimes(1);
    expect(onEditQueued).toHaveBeenCalledWith(queuedItem);
  });

  it("calls guide callback from the inline guide action", () => {
    const onGuideQueued = vi.fn();
    render(<ComposerQueue queuedMessages={[queuedItem]} onGuideQueued={onGuideQueued} />);

    fireEvent.click(screen.getByLabelText("Guide queued message"));

    expect(onGuideQueued).toHaveBeenCalledTimes(1);
    expect(onGuideQueued).toHaveBeenCalledWith(queuedItem);
  });

  it("calls delete callback for selected queued item", () => {
    const onDeleteQueued = vi.fn();
    render(<ComposerQueue queuedMessages={[queuedItem]} onDeleteQueued={onDeleteQueued} />);

    fireEvent.click(screen.getByLabelText("Delete queued message"));

    expect(onDeleteQueued).toHaveBeenCalledTimes(1);
    expect(onDeleteQueued).toHaveBeenCalledWith(queuedItem.id);
  });
});
