import { describe, expect, it } from "vitest";
import { catalogEn } from "./catalog-en";
import { catalogVi } from "./catalog-vi";
import { createTranslator } from "./translate";

describe("createTranslator", () => {
  it("resolves a plain key with no params", () => {
    const t = createTranslator(catalogEn);
    expect(t("tool.select")).toBe("Selection");
  });

  it("interpolates a single {token} placeholder from params", () => {
    const t = createTranslator(catalogEn);
    expect(t("topbar.zoomPercentage", { percent: 150 })).toBe("150%");
  });

  it("leaves an unmatched placeholder untouched when params omits that token", () => {
    const t = createTranslator(catalogEn);
    expect(t("topbar.zoomPercentage", {})).toBe("{percent}%");
  });

  it("works against any locale catalog with the same key shape (Vietnamese)", () => {
    const t = createTranslator(catalogVi);
    expect(t("topbar.zoomPercentage", { percent: 50 })).toBe("50%");
    expect(t("tool.select")).toBe("Chọn");
  });
});
