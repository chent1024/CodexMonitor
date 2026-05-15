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
const workspaceId = args.get("workspace") ?? process.env.WORKSPACE_ID ?? null;
const terminalId = args.get("terminal") ?? `bench-${Date.now()}`;
const megabytes = Math.max(1, Number(args.get("mb") ?? 5));
const timeoutMs = Math.max(5_000, Number(args.get("timeout") ?? 60_000));
const token = args.get("token") ?? process.env.CODEX_MONITOR_DAEMON_TOKEN ?? null;
const marker = `__CODEX_TERMINAL_BENCH_DONE_${Date.now()}__`;

let nextId = 1;
const pending = new Map();
let selectedWorkspaceId = workspaceId;
let bytes = 0;
let events = 0;
let openedAt = 0;
let finished = false;

const socket = net.createConnection({ host, port });
socket.setEncoding("utf8");

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
  if (message.method !== "terminal-output") {
    return;
  }
  const params = message.params ?? {};
  if (params.workspaceId !== selectedWorkspaceId || params.terminalId !== terminalId) {
    return;
  }
  const data = String(params.data ?? "");
  bytes += Buffer.byteLength(data);
  events += 1;
  if (data.includes(marker)) {
    finished = true;
    const elapsedMs = Math.max(1, Date.now() - openedAt);
    const mib = bytes / 1024 / 1024;
    console.log(
      JSON.stringify(
        {
          workspaceId: selectedWorkspaceId,
          terminalId,
          bytes,
          events,
          elapsedMs,
          mibPerSecond: Number((mib / (elapsedMs / 1000)).toFixed(2)),
          averageEventBytes: events > 0 ? Math.round(bytes / events) : 0,
        },
        null,
        2,
      ),
    );
    void closeAndExit(0);
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
  if (!finished) {
    console.error(error.message);
    process.exitCode = 1;
  }
});

async function closeAndExit(code) {
  try {
    if (selectedWorkspaceId) {
      await call("terminal_close", {
        workspaceId: selectedWorkspaceId,
        terminalId,
      });
    }
  } catch {
    // The terminal may already have exited.
  } finally {
    socket.end();
    process.exit(code);
  }
}

function windowsBenchCommand() {
  const chunks = Math.ceil((megabytes * 1024 * 1024) / 1024);
  const markerPrefix = marker.slice(0, 8);
  const markerSuffix = marker.slice(8);
  return `powershell -NoProfile -Command "$chunk='x'*1024; $m='${markerPrefix}'+'${markerSuffix}'; 1..${chunks} | ForEach-Object { $chunk }; Write-Output $m"\r`;
}

async function main() {
  await new Promise((resolve) => socket.once("connect", resolve));
  if (token) {
    await call("auth", { token });
  }
  if (!selectedWorkspaceId) {
    const workspaces = await call("list_workspaces", {});
    const workspace = Array.isArray(workspaces)
      ? workspaces.find((entry) => entry.connected) ?? workspaces[0]
      : null;
    selectedWorkspaceId = workspace?.id ?? null;
  }
  if (!selectedWorkspaceId) {
    throw new Error("No workspace found. Pass --workspace <id> or set WORKSPACE_ID.");
  }

  await call("terminal_open", {
    workspaceId: selectedWorkspaceId,
    terminalId,
    cols: 120,
    rows: 30,
  });
  openedAt = Date.now();
  await call("terminal_write", {
    workspaceId: selectedWorkspaceId,
    terminalId,
    data: windowsBenchCommand(),
  });

  setTimeout(() => {
    if (!finished) {
      console.error(`Timed out after ${timeoutMs}ms`);
      void closeAndExit(1);
    }
  }, timeoutMs).unref();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  void closeAndExit(1);
});
