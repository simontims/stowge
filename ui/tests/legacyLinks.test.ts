import { describe, expect, it } from "vitest";
import { upgradeLegacyCollectionLink } from "../src/lib/legacyLinks";

describe("old ?collection= links", () => {
  it("leave links without the parameter alone", () => {
    expect(upgradeLegacyCollectionLink("")).toBeNull();
    expect(upgradeLegacyCollectionLink("?tag=Cables&q=usb")).toBeNull();
  });
  it("become ?tag= and keep every other parameter", () => {
    expect(upgradeLegacyCollectionLink("?collection=Attic")).toBe("?tag=Attic");
    expect(upgradeLegacyCollectionLink("?q=usb&collection=Electronic%20Parts&status=draft")).toBe("?q=usb&status=draft&tag=Electronic+Parts");
  });
  it("keep 'no collection' as untagged", () => {
    expect(upgradeLegacyCollectionLink("?collection=__none")).toBe("?tag=__none");
  });
  it("an existing tag wins, and an empty collection is just dropped", () => {
    expect(upgradeLegacyCollectionLink("?collection=Attic&tag=Tools")).toBe("?tag=Tools");
    expect(upgradeLegacyCollectionLink("?collection=&q=x")).toBe("?q=x");
    expect(upgradeLegacyCollectionLink("?collection=")).toBe("");
  });
});
