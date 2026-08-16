/**
 * One live scene per stdio process — the session every tool handler mutates. Holds the full page
 * list of an opened `.devivadraw` file (multi-page envelope or legacy single-scene document, via
 * the engine's lenient multi-page reader) but exposes only the ACTIVE page's `Scene` to tools;
 * save writes the whole document back, preserving untouched pages and per-page cameras.
 *
 * File access policy (see the plan's security section): only explicit agent-passed paths are ever
 * read or written — no directory walking — and when a root directory is configured (CLI `--root` /
 * `DEVIVA_MCP_ROOT`), every resolved path must live inside it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { PageStore } from "@deviva-draw/collab-client";
import { deserializeMultiPageDocumentLenient, MULTI_PAGE_DOCUMENT_TYPE, Scene, serializeScene } from "@deviva-draw/engine";
import type { TextMeasurer } from "@deviva-draw/engine";
import { createApproximateTextMeasurer } from "./approximate-measurer";
import { liveElementCount, ToolError } from "./tools/tool-types";
import type { OpenSceneResult, ToolSession } from "./tools/tool-types";

export interface SceneSessionOptions {
  /** Directory every file path must resolve inside; `null`/absent disables the restriction. */
  rootDir?: string | null;
  /**
   * Measurer every tool uses for label wrap + text sizing. Injected (not imported) so the shared
   * tool core stays canvas-free: the stdio entry supplies the exact `@napi-rs/canvas`-backed one
   * when that optional install is present; default is the approximate fallback.
   */
  measurer?: TextMeasurer;
}

export class SceneSession implements ToolSession {
  /**
   * The page list — the same `PageStore` class the browser shell runs, so the live-session bridge
   * can hand it straight to the canonical collab pages adapter and remote page operations (add,
   * rename, delete from the user's tab) reflect here with browser-identical semantics.
   */
  private store: PageStore = PageStore.fresh();
  private boundPath: string | null = null;
  /** Whether the opened file used the multi-page envelope — save must write the same format back. */
  private sourceIsMultiPage = false;
  /**
   * Non-`null` while the live-session bridge has this session's scene bound to a collab room:
   * `new_scene`/`open_scene` would swap the scene out from under the room, so both refuse with
   * this message. Save/export stay allowed — they read the same live scene.
   */
  private lockReason: string | null = null;
  private readonly rootDir: string | null;
  readonly measurer: TextMeasurer;

  constructor(options: SceneSessionOptions = {}) {
    this.rootDir = options.rootDir ? resolve(options.rootDir) : null;
    this.measurer = options.measurer ?? createApproximateTextMeasurer();
  }

  /** The active page's live scene — the one object every element/diagram/export tool operates on. */
  get scene(): Scene {
    return this.store.getActiveScene();
  }

  get activePage(): { id: string; name: string } {
    const activeId = this.store.getActivePageId();
    const page = this.store.getPages().find((entry) => entry.id === activeId);
    if (!page) throw new Error("scene-session: active page missing from the store (bug)");
    return page;
  }

  get pageCount(): number {
    return this.store.getPages().length;
  }

  /** The live page list — what the bridge binds to the room's pages adapter. */
  get pageStore(): PageStore {
    return this.store;
  }

  get filePath(): string | null {
    return this.boundPath;
  }

  /** Resolves an agent-passed path and enforces the configured root, if any. */
  resolvePath(path: string): string {
    const resolved = resolve(path);
    if (this.rootDir !== null && resolved !== this.rootDir && !resolved.startsWith(this.rootDir + sep)) {
      throw new ToolError(`path "${path}" resolves outside the allowed root directory "${this.rootDir}" — pass a path inside it`);
    }
    return resolved;
  }

  lockScene(reason: string): void {
    this.lockReason = reason;
  }

  unlockScene(): void {
    this.lockReason = null;
  }

  private assertNotLocked(): void {
    if (this.lockReason !== null) throw new ToolError(this.lockReason);
  }

  /** Discards the current document and starts a fresh, unbound single-page scene. */
  newScene(): void {
    this.assertNotLocked();
    this.store = PageStore.fresh();
    this.boundPath = null;
    this.sourceIsMultiPage = false;
  }

  openScene(path: string): OpenSceneResult {
    this.assertNotLocked();
    const resolved = this.resolvePath(path);
    let text: string;
    try {
      text = readFileSync(resolved, "utf8");
    } catch (error) {
      throw new ToolError(`cannot read "${path}": ${error instanceof Error ? error.message : String(error)}`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new ToolError(`"${path}" is not valid JSON — expected a Deviva Draw scene or document file`);
    }
    const result = deserializeMultiPageDocumentLenient(raw);
    if (!result.ok) throw new ToolError(`"${path}" is not a readable Deviva Draw file: ${result.error}`);

    // A fresh store per open (subscribers are never carried across documents — the live bridge
    // locks this method away while connected, so no live adapter can be watching the old store).
    this.store = new PageStore(result.pages, result.activePageId);
    this.boundPath = resolved;
    this.sourceIsMultiPage = typeof raw === "object" && raw !== null && (raw as Record<string, unknown>).type === MULTI_PAGE_DOCUMENT_TYPE;
    return {
      path: resolved,
      pageCount: this.pageCount,
      activePageName: this.activePage.name,
      elementCount: liveElementCount(this.scene),
      droppedErrors: result.droppedErrors,
    };
  }

  /**
   * Writes the whole document to `path` (or the bound path from `open_scene`). Single-scene inputs
   * and fresh sessions save as a plain scene document; multi-page inputs save the full envelope so
   * pages this session never touched survive byte-faithfully (tombstones kept for both — a saved
   * file is a working document, not an export, so undo history semantics survive a reopen).
   */
  saveScene(path?: string): { path: string } {
    const target = path !== undefined ? this.resolvePath(path) : this.boundPath;
    if (target === null) {
      throw new ToolError("no file is bound to this session — pass a \"path\" to save_scene (or open_scene first)");
    }
    const document =
      this.sourceIsMultiPage || this.pageCount > 1
        ? this.store.toDocument(true) // multi-page envelope with parked cameras, tombstones kept
        : serializeScene(this.scene, { includeDeleted: true });
    try {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(document), "utf8");
    } catch (error) {
      throw new ToolError(`cannot write "${path ?? target}": ${error instanceof Error ? error.message : String(error)}`);
    }
    this.boundPath = target;
    return { path: target };
  }
}
