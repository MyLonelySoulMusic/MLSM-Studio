import { describe, expect, it } from "vitest";
import { restoreInstallerInvocation } from "./vite-restore-service";

describe("Restore service targeted repair", () => {
  it("usa Node direttamente su entrambe le piattaforme, senza quoting shell", () => {
    const invocation = restoreInstallerInvocation();
    expect(invocation.command).toBe(process.execPath);
    expect(invocation.args).toHaveLength(1);
    expect(invocation.args[0]).toMatch(/tools[\\/]repair_installation\.cjs$/);
    expect(invocation.args[0]).not.toContain('"');
  });
});
