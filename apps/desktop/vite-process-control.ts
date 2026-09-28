import { spawnSync } from "node:child_process";

function normalized(value: string) {
  return value.replaceAll("\\", "/").replace(/\/+/g, "/").trim().toLowerCase();
}

export function commandLineMatchesEntry(commandLine: string, expectedEntry: string) {
  const command = normalized(commandLine);
  const entry = normalized(expectedEntry);
  return Boolean(command && entry && command.includes(entry));
}

function output(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function listeningPids(port: number, platform = process.platform) {
  const raw = platform === "win32"
    ? output("powershell.exe", ["-NoProfile", "-Command", `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`])
    : output("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  return [...new Set(raw.split(/\s+/).map(value => Number(value)).filter(value => Number.isInteger(value) && value > 1))];
}

function processCommandLine(pid: number, platform = process.platform) {
  return platform === "win32"
    ? output("powershell.exe", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}").CommandLine`])
    : output("ps", ["-o", "command=", "-p", String(pid)]);
}

/** Terminates only a listener whose command line contains the exact backend
 * entrypoint owned by this checkout. A foreign process that happens to use the
 * same port is deliberately left untouched. */
export function terminateVerifiedListener(port: number, expectedEntry: string, platform = process.platform) {
  const terminated: number[] = [];
  for (const pid of listeningPids(port, platform)) {
    if (!commandLineMatchesEntry(processCommandLine(pid, platform), expectedEntry)) continue;
    try {
      if (platform === "win32") {
        const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
        if (result.status !== 0) continue;
      } else process.kill(pid, "SIGTERM");
      terminated.push(pid);
    } catch { /* It may have exited between inspection and termination. */ }
  }
  return terminated;
}
