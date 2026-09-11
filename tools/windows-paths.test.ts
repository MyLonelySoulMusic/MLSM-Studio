import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_FORBIDDEN_CHARACTER = /[<>:"\\|?*]/;

function windowsPathProblem(path: string): string | null {
  for (const component of path.split("/")) {
    if (WINDOWS_FORBIDDEN_CHARACTER.test(component) || [...component].some(character => character.charCodeAt(0) <= 31)) return "contiene un carattere vietato da Windows";
    if (/[ .]$/.test(component)) return "termina con uno spazio o un punto";
    if (WINDOWS_RESERVED_NAME.test(component)) return "usa un nome riservato da Windows";
  }
  return null;
}

function trackedWorkingTreePaths(): string[] {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((path): path is string => Boolean(path) && existsSync(path));
}

describe("portabilità dei percorsi Git", () => {
  it("riconosce i nomi incompatibili con Windows", () => {
    expect(windowsPathProblem(":memory:.ses")).toContain("carattere vietato");
    expect(windowsPathProblem("reports/CON.txt")).toContain("nome riservato");
    expect(windowsPathProblem("reports/finale. ")).toContain("spazio o un punto");
    expect(windowsPathProblem("apps/desktop/src/App.tsx")).toBeNull();
  });

  it("mantiene tutti i percorsi versionati compatibili con Windows e macOS", () => {
    const paths = trackedWorkingTreePaths();
    const problems = paths.flatMap(path => {
      const problem = windowsPathProblem(path);
      return problem ? [`${path}: ${problem}`] : [];
    });
    const caseInsensitive = new Map<string, string>();
    for (const path of paths) {
      const key = path.normalize("NFC").toLocaleLowerCase("en-US");
      const previous = caseInsensitive.get(key);
      if (previous && previous !== path) problems.push(`${previous} e ${path}: collisione senza distinzione maiuscole/minuscole`);
      else caseInsensitive.set(key, path);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
