import { describe, expect, it } from "vitest";
import { restoreInstallerInvocation } from "./vite-restore-service";

describe("Restore service platform installer", () => {
  it("seleziona l'installer macOS senza dipendere dalla shell utente", () => {
    const invocation = restoreInstallerInvocation("darwin");
    expect(invocation.command).toBe("bash");
    expect(invocation.args.at(-1)).toMatch(/scripts\/macos\/install\.sh$/);
  });

  it("seleziona l'installer Windows tramite cmd.exe", () => {
    const invocation = restoreInstallerInvocation("win32");
    expect(invocation.command).toBe("cmd.exe");
    expect(invocation.args).toEqual(expect.arrayContaining(["/d", "/s", "/c"]));
    expect(invocation.args.at(-1)).toMatch(/^call ".*scripts\/windows\/install\.bat"$/);
  });
});
