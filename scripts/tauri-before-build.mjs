#!/usr/bin/env node
import { copyFileSync, chmodSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const tauriDir = path.join(repoRoot, "src-tauri");
const sidecarsDir = path.join(tauriDir, "target", "sidecars");

const sidecars = ["codex_monitor_daemon", "codex_monitor_daemonctl"];
const mobilePlatforms = new Set(["android", "ios"]);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    const rendered = [command, ...args].join(" ");
    process.exitCode = result.status ?? 1;
    throw new Error(`Command failed: ${rendered}`);
  }
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim();
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function cargoCommand() {
  return process.platform === "win32" ? "cargo.exe" : "cargo";
}

function rustcHostTriple() {
  const output = capture("rustc", ["-vV"], { cwd: tauriDir });
  const hostLine = output
    ?.split(/\r?\n/)
    .find((line) => line.startsWith("host: "));
  return hostLine?.slice("host: ".length).trim() || null;
}

function normalizedArch() {
  const arch = process.env.TAURI_ENV_ARCH || process.arch;
  if (arch === "x64") {
    return "x86_64";
  }
  if (arch === "arm64") {
    return "aarch64";
  }
  return arch;
}

function targetTripleFromTauriEnv() {
  const platform = process.env.TAURI_ENV_PLATFORM || process.platform;
  const arch = normalizedArch();
  if (platform === "windows" || platform === "win32") {
    return `${arch}-pc-windows-msvc`;
  }
  if (platform === "darwin" || platform === "macos") {
    return `${arch}-apple-darwin`;
  }
  if (platform === "linux") {
    return `${arch}-unknown-linux-gnu`;
  }
  return rustcHostTriple();
}

function resolveTargetTriple() {
  return (
    process.env.CARGO_BUILD_TARGET?.trim() ||
    process.env.TAURI_ENV_TARGET_TRIPLE?.trim() ||
    targetTripleFromTauriEnv() ||
    rustcHostTriple()
  );
}

function targetRoot() {
  const configured = process.env.CARGO_TARGET_DIR?.trim();
  if (!configured) {
    return path.join(tauriDir, "target");
  }
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(tauriDir, configured);
}

function releaseDirs(targetTriple, usesExplicitTarget) {
  const root = targetRoot();
  const dirs = [];
  if (usesExplicitTarget) {
    dirs.push(path.join(root, targetTriple, "release"));
  }
  dirs.push(path.join(root, "release"));
  dirs.push(path.join(root, targetTriple, "release"));
  return [...new Set(dirs)];
}

function findBuiltSidecar(name, targetTriple, usesExplicitTarget) {
  const extension = targetTriple.includes("windows") ? ".exe" : "";
  for (const releaseDir of releaseDirs(targetTriple, usesExplicitTarget)) {
    const candidate = path.join(releaseDir, `${name}${extension}`);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function buildSidecars(targetTriple, usesExplicitTarget) {
  const args = [
    "build",
    "--release",
    "--bin",
    "codex_monitor_daemon",
    "--bin",
    "codex_monitor_daemonctl",
  ];
  if (usesExplicitTarget) {
    args.push("--target", targetTriple);
  }
  run(cargoCommand(), args, {
    cwd: tauriDir,
    env: {
      // The daemon sidecars must be built before Tauri can bundle them. Without
      // this override, the package build script tries to collect externalBin
      // files that this command is in the middle of producing.
      TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }),
    },
  });
}

function copySidecars(targetTriple, usesExplicitTarget) {
  mkdirSync(sidecarsDir, { recursive: true });
  const extension = targetTriple.includes("windows") ? ".exe" : "";

  for (const sidecar of sidecars) {
    const source = findBuiltSidecar(sidecar, targetTriple, usesExplicitTarget);
    if (!source) {
      throw new Error(
        `Built sidecar not found for ${sidecar} (${targetTriple}) in ${releaseDirs(
          targetTriple,
          usesExplicitTarget,
        ).join(", ")}`,
      );
    }

    const destination = path.join(sidecarsDir, `${sidecar}-${targetTriple}${extension}`);
    copyFileSync(source, destination);
    if (process.platform !== "win32") {
      chmodSync(destination, 0o755);
    }
    console.log(`[tauri-before-build] prepared ${destination}`);
  }
}

run(npmCommand(), ["run", "build"]);

const platform = process.env.TAURI_ENV_PLATFORM || process.platform;
if (mobilePlatforms.has(platform)) {
  console.log(`[tauri-before-build] skipping desktop daemon sidecars for ${platform}`);
  process.exit(0);
}

const targetTriple = resolveTargetTriple();
if (!targetTriple) {
  throw new Error("Unable to resolve Rust target triple for daemon sidecars.");
}

const usesExplicitTarget = Boolean(
  process.env.CARGO_BUILD_TARGET?.trim() ||
    process.env.TAURI_ENV_TARGET_TRIPLE?.trim(),
);

console.log(`[tauri-before-build] building daemon sidecars for ${targetTriple}`);
buildSidecars(targetTriple, usesExplicitTarget);
copySidecars(targetTriple, usesExplicitTarget);
