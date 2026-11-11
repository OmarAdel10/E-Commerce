import { describe, expect, it } from "vitest";
import { collectRepositoryHygieneFailures } from "./repository-hygiene.mjs";

describe("repository hygiene", () => {
  it("exempts only root assistant instructions and CLI documentation from the text scan", () => {
    const files = [
      "AGENTS.md", "CLAUDE.md", "packages/cli/README.md",
      "docs/AGENTS.md", "apps/api/CLAUDE.md", "docs/architecture.md",
    ];
    const failures = collectRepositoryHygieneFailures(files, { readText: () => "Instructions for Claude Code." });
    expect(failures.map((failure) => failure.split(":")[0])).toEqual([
      "docs/AGENTS.md", "apps/api/CLAUDE.md", "docs/architecture.md",
    ]);
  });

  it("still detects secret-bearing paths in private files and accepts templates", () => {
    const failures = collectRepositoryHygieneFailures(["apps/api/.dev.vars", "apps/api/.dev.vars.example"], {
      isPrivate: () => true,
    });
    expect(failures).toEqual(["apps/api/.dev.vars: secret-bearing environment file must not be tracked"]);
  });
});
