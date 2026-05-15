import net from "node:net";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) {
    continue;
  }
  const key = arg.slice(2);
  const next = process.argv[i + 1];
  if (!next || next.startsWith("--")) {
    args.set(key, "true");
  } else {
    args.set(key, next);
    i += 1;
  }
}

const host = args.get("host") ?? process.env.CODEX_MONITOR_DAEMON_HOST ?? "127.0.0.1";
const port = Number(args.get("port") ?? process.env.CODEX_MONITOR_DAEMON_PORT ?? 4732);
const token = args.get("token") ?? process.env.CODEX_MONITOR_DAEMON_TOKEN ?? null;
const workspaceId = args.get("workspace") ?? process.env.WORKSPACE_ID ?? null;
const threadId = args.get("thread") ?? process.env.THREAD_ID ?? null;
const durationMs = Math.max(1_000, Number(args.get("duration") ?? 30_000));

let nextId = 1;
const pending = new Map();
const socket = net.createConnection({ host, port });
socket.setEncoding("utf8");

let selectedWorkspaceId = workspaceId;
let startedAt = 0;
let eventCount = 0;
let byteCount = 0;
let gapCount = 0;
let firstEventAt = 0;
let lastEventAt = 0;
let done = false;

function call(method, params = {}) {
  const id = nextId++;
  const payload = JSON.stringify({ id, method, params });
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.write(`${payload}\n`);
  });
}

function parseLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id && pending.has(message.id)) {
    const deferred = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      deferred.reject(new Error(message.error.message ?? "daemon RPC error"));
    } else {
      deferred.resolve(message.result);
    }
    return;
  }
  if (message.method !== "app-server-event") {
    return;
  }
  const params = message.params ?? {};
  const eventWorkspaceId = params.workspace_id ?? params.workspaceId ?? null;
  if (selectedWorkspaceId && eventWorkspaceId && eventWorkspaceId !== selectedWorkspaceId) {
    return;
  }
  const serialized = JSON.stringify(params);
  const now = Date.now();
  firstEventAt ||= now;
  lastEventAt = now;
  eventCount += 1;
  byteCount += Buffer.byteLength(serialized);
  if (serialized.includes("codex/event_gap")) {
    gapCount += 1;
  }
}

let buffered = "";
socket.on("data", (chunk) => {
  buffered += chunk;
  let index;
  while ((index = buffered.indexOf("\n")) >= 0) {
    const line = buffered.slice(0, index).trim();
    buffered = buffered.slice(index + 1);
    if (line) {
      parseLine(line);
    }
  }
});

socket.on("error", (error) => {
  if (!done) {
    console.error(error.message);
    process.exitCode = 1;
  }
});

async function chooseWorkspace() {
  if (selectedWorkspaceId) {
    return;
  }
  const workspaces = await call("list_workspaces", {});
  const workspace = Array.isArray(workspaces)
    ? workspaces.find((entry) => entry.connected) ?? workspaces[0]
    : null;
  selectedWorkspaceId = workspace?.id ?? null;
  if (!selectedWorkspaceId) {
    throw new Error("No workspace found. Pass --workspace <id> or set WORKSPACE_ID.");
  }
}

function finish(code = 0) {
  done = true;
  const elapsedMs = Math.max(1, Date.now() - startedAt);
  const activeMs = firstEventAt && lastEventAt ? Math.max(1, lastEventAt - firstEventAt) : 0;
  console.log(
    JSON.stringify(
      {
        workspaceId: selectedWorkspaceId,
        threadId,
        durationMs: elapsedMs,
        observedActiveMs: activeMs,
        events: eventCount,
        gaps: gapCount,
        bytes: byteCount,
        eventsPerSecond: Number((eventCount / (elapsedMs / 1000)).toFixed(2)),
        mibPerSecond: Number((byteCount / 1024 / 1024 / (elapsedMs / 1000)).toFixed(2)),
        averageEventBytes: eventCount > 0 ? Math.round(byteCount / eventCount) : 0,
      },
      null,
      2,
    ),
  );
  socket.end();
  process.exit(code);
}

async function main() {
  await new Promise((resolve) => socket.once("connect", resolve));
  if (token) {
    await call("auth", { token });
  }
  await chooseWorkspace();
  if (threadId) {
    await call("thread_live_subscribe", {
      workspaceId: selectedWorkspaceId,
      threadId,
    });
  }
  startedAt = Date.now();
  setTimeout(() => finish(0), durationMs).unref();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  socket.end();
  process.exit(1);
});
