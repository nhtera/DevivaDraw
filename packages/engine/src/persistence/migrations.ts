/**
 * Schema migration registry. Empty today — version 1 is the first shipped schema, so there is nothing
 * to migrate *from* yet — but the registry exists from the very first commit specifically so the
 * first real schema change (a new required field, a renamed key, a new element variant needing a
 * default) has a migration path instead of stranding every already-saved `.devivadraw` file/localStorage
 * snapshot written before that change shipped. See `scene-schema.ts`'s module doc for the versioning
 * rationale.
 */
import { CURRENT_SCHEMA_VERSION } from "./scene-schema";

/** Upgrades a raw (already-parsed, not yet validated) document one schema version forward — from the version this function is keyed under in `migrations`, to that version + 1. Operates on loosely-typed `Record<string, unknown>` since a document mid-migration chain doesn't yet match any single version's strict type. */
export type SceneMigration = (document: Record<string, unknown>) => Record<string, unknown>;

/**
 * Keyed by the version a migration upgrades *from* (`migrations[1]` takes a v1 document and returns a
 * v2 document). Add an entry here — never mutate/remove an old one — each time `CURRENT_SCHEMA_VERSION`
 * bumps, so every previously-saved document keeps a path forward.
 */
export const migrations: Record<number, SceneMigration> = {};

/** Thrown when a document's `schemaVersion` is newer than this build understands — refuses to guess a downgrade, since that would silently drop fields a newer build actually needs. */
export class UnsupportedSchemaVersionError extends Error {
  constructor(
    readonly foundVersion: number,
    readonly maxSupportedVersion: number,
  ) {
    super(`migrations: schema version ${foundVersion} is newer than this build supports (max ${maxSupportedVersion}) — refusing to guess a downgrade`);
    this.name = "UnsupportedSchemaVersionError";
  }
}

/**
 * Applies every registered migration in sequence, from `fromVersion` up to `targetVersion` (defaults
 * to `CURRENT_SCHEMA_VERSION`). No-ops (returns `document` unchanged except for a normalized
 * `schemaVersion` field) when already at `targetVersion`. Throws `UnsupportedSchemaVersionError` for a
 * document newer than `targetVersion` — never guesses a downgrade — and a plain `Error` if a migration
 * step is missing from the registry (a broken chain: every version between `fromVersion` and
 * `targetVersion` must have an entry, or this is a bug in `migrations`, not malformed input).
 */
export function applyMigrations(
  document: Record<string, unknown>,
  fromVersion: number,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): Record<string, unknown> {
  if (fromVersion > targetVersion) throw new UnsupportedSchemaVersionError(fromVersion, targetVersion);

  let current = document;
  let version = fromVersion;
  while (version < targetVersion) {
    const migrate = migrations[version];
    if (!migrate) throw new Error(`migrations: no migration registered from schema version ${version} to ${version + 1}`);
    current = migrate(current);
    version += 1;
  }
  // Guarantee the field itself matches the target, regardless of whether an individual migration
  // function remembered to set it — the loop's own bookkeeping is the single source of truth.
  return { ...current, schemaVersion: targetVersion };
}
