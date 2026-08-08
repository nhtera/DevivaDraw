import { describe, expect, it } from "vitest";
import { applyMigrations, migrations, UnsupportedSchemaVersionError } from "./migrations";
import { CURRENT_SCHEMA_VERSION } from "./scene-schema";

describe("applyMigrations", () => {
  it("no-ops (beyond normalizing schemaVersion) when already at the target version", () => {
    const document = { schemaVersion: CURRENT_SCHEMA_VERSION, elements: [] };
    expect(applyMigrations(document, CURRENT_SCHEMA_VERSION)).toEqual(document);
  });

  it("throws UnsupportedSchemaVersionError for a document newer than the target version — never guesses a downgrade", () => {
    const future = { schemaVersion: CURRENT_SCHEMA_VERSION + 5, elements: [] };
    expect(() => applyMigrations(future, CURRENT_SCHEMA_VERSION + 5, CURRENT_SCHEMA_VERSION)).toThrow(UnsupportedSchemaVersionError);
  });

  it("applies a registered migration chain in order, from fromVersion up to targetVersion", () => {
    // `migrations` is a real, mutable registry (empty today since v1 is the first schema) —
    // temporarily registering fixture entries exercises `applyMigrations`'s actual chaining loop,
    // not a reimplementation of it.
    migrations[1] = (document) => ({ ...document, addedByV1ToV2: true });
    migrations[2] = (document) => ({ ...document, addedByV2ToV3: true });
    try {
      const result = applyMigrations({ schemaVersion: 1 }, 1, 3);
      expect(result).toEqual({ schemaVersion: 3, addedByV1ToV2: true, addedByV2ToV3: true });
    } finally {
      delete migrations[1];
      delete migrations[2];
    }
  });

  it("throws when a migration step is missing from the middle of the chain", () => {
    // `migrations` is empty today (version 1 is the first schema) — requesting an upgrade from a
    // hypothetical version 0 exposes the "missing migration" branch without needing to register one.
    expect(() => applyMigrations({ schemaVersion: 0 }, 0, CURRENT_SCHEMA_VERSION)).toThrow(/no migration registered/);
  });

  it("the registry is empty for the first shipped schema version — nothing to migrate from yet", () => {
    expect(Object.keys(migrations)).toHaveLength(0);
  });

  it("normalizes the schemaVersion field on the returned document even when nothing else changes", () => {
    const document = { schemaVersion: CURRENT_SCHEMA_VERSION, elements: [], extra: "kept" };
    const result = applyMigrations(document, CURRENT_SCHEMA_VERSION);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.extra).toBe("kept");
  });
});
