import { describe, expect, it } from "vitest";
import { documentationTopics } from "./documentation-content";
import { lexicalDocumentationSearch } from "./documentation-search";

describe("documentation search", () => {
  it("finds an area from a user goal in Italian", () => {
    const [result] = lexicalDocumentationSearch("trascrivere audio con whisper", documentationTopics("it"));
    expect(result?.topic.id).toBe("audio");
  });

  it("finds the relevant English workflow", () => {
    const [result] = lexicalDocumentationSearch("append another Excel file to my dashboard", documentationTopics("en"));
    expect(result?.topic.id).toBe("reports");
  });
});
