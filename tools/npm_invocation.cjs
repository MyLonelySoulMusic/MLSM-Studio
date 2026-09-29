/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
const { existsSync } = require("node:fs");
const { dirname, join, win32 } = require("node:path");

// npm.cmd is a batch wrapper, not an executable. Prefer npm's JS entry point
// with the SAME Node binary used by Studio, including nvm/custom installations.
function npmInvocation(args, { platform = process.platform, env = process.env, execPath = process.execPath, exists = existsSync } = {}) {
  const path = platform === "win32" ? win32 : { dirname, join };
  const directories = [path.dirname(execPath)];
  if (platform === "win32") {
    const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] || "";
    directories.push(...pathValue.split(";").map(value => value.replace(/^"|"$/g, "")), path.join(env.ProgramFiles || "C:\\Program Files", "nodejs"));
  }
  const candidates = [
    env.npm_execpath && /(?:^|[\\/])npm-cli\.js$/i.test(env.npm_execpath) ? env.npm_execpath : null,
    ...directories.filter(Boolean).map(directory => path.join(directory, "node_modules", "npm", "bin", "npm-cli.js")),
    platform !== "win32" && path.join(path.dirname(execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const cli = candidates.find(candidate => candidate && exists(candidate));
  if (cli) return { command: execPath, args: [cli, ...args], options: {} };
  if (platform !== "win32") return { command: "npm", args, options: {} };
  // Only internal fixed npm switches/subcommands may reach this fallback.
  if (args.some(arg => !/^[\w=.:/-]+$/.test(arg))) throw new Error("Argomento npm non sicuro per cmd.exe");
  return { command: env.ComSpec || env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c", `npm.cmd ${args.join(" ")}`], options: { windowsVerbatimArguments: true } };
}

module.exports = { npmInvocation };
