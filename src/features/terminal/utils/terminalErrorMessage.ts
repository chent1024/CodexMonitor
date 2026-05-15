function detailFromUnknown(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return String(error);
}

export function formatTerminalOpenErrorMessage(error: unknown): string {
  const detail = detailFromUnknown(error).trim();
  if (!detail || detail === "[object Object]" || detail === "undefined") {
    return "Failed to start terminal session.";
  }
  return `Failed to start terminal session: ${detail}`;
}
