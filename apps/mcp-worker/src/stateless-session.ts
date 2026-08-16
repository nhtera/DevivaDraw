/**
 * The stateless contract: every `tools/call` carries the scene IN (optional `scene` argument, a
 * serialized scene document from a previous call) and gets the updated scene OUT (the response's
 * `scene` field). Nothing is stored between calls — no session ids, no persistence — preserving
 * the zero-knowledge stance. `StatelessSession` satisfies the tool core's `ToolSession` interface
 * with file methods that throw an actionable pointer at the local `npx @deviva-draw/mcp` server.
 */
import { deserializeScene, Scene, serializeScene } from "@deviva-draw/engine";
import type { SceneDocumentV1, TextMeasurer } from "@deviva-draw/engine";
import { createApproximateTextMeasurer, ToolError } from "@deviva-draw/mcp/core";
import type { OpenSceneResult, ToolSession } from "@deviva-draw/mcp/core";

const FILE_UNAVAILABLE =
  "file paths are not available on the remote server — the scene travels in and out of every call as JSON (\"scene\" argument / response field); for file access run the local server: npx @deviva-draw/mcp";

export class StatelessSession implements ToolSession {
  readonly scene: Scene;
  readonly measurer: TextMeasurer = createApproximateTextMeasurer();
  readonly filePath = null;
  readonly pageCount = 1;
  readonly activePage = { id: "remote", name: "Remote scene" };

  constructor(scene: Scene) {
    this.scene = scene;
  }

  resolvePath(): string {
    throw new ToolError(FILE_UNAVAILABLE);
  }

  // Interface compliance only — `new_scene` is not in `remoteTools`, so tool lookup rejects the
  // call before this could run ("unknown tool"); remotely, omitting `scene` IS the fresh scene.
  newScene(): void {
    throw new ToolError("new_scene is not needed remotely — omit the \"scene\" argument to start from an empty scene");
  }

  openScene(): OpenSceneResult {
    throw new ToolError(FILE_UNAVAILABLE);
  }

  saveScene(): { path: string } {
    throw new ToolError(FILE_UNAVAILABLE);
  }
}

/** Builds the per-call session: no `scene` argument → fresh empty scene; otherwise a STRICT parse (a corrupted round-tripped scene must fail loudly, not silently drop content). */
export function sessionFromSceneArgument(sceneArgument: unknown): StatelessSession {
  if (sceneArgument === undefined || sceneArgument === null) return new StatelessSession(new Scene());
  const result = deserializeScene(sceneArgument);
  if (!result.ok) {
    throw new ToolError(`invalid "scene" argument: ${result.error} — pass the exact scene JSON a previous call returned`);
  }
  return new StatelessSession(result.scene);
}

/** The scene document handed back on every call — tombstones kept so a delete survives the next round-trip's re-ingest. */
export function serializeSessionScene(session: StatelessSession): SceneDocumentV1 {
  return serializeScene(session.scene, { includeDeleted: true });
}
