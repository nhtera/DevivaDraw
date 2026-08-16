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
import { deserializeMultiPageDocumentLenient, generatePageId, MULTI_PAGE_DOCUMENT_TYPE, Scene, serializeMultiPageDocument, serializeScene } from "@deviva-draw/engine";
import type { ScenePage, TextMeasurer } from "@deviva-draw/engine";
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

function freshPage(): ScenePage {
  return { id: generatePageId(), name: "Page 1", scene: new Scene() };
}

export class SceneSession implements ToolSession {
  private pages: ScenePage[] = [freshPage()];
  private activeIndex = 0;
  private boundPath: string | null = null;
  /** Whether the opened file used the multi-page envelope — save must write the same format back. */
  private sourceIsMultiPage = false;
  private readonly rootDir: string | null;
  readonly measurer: TextMeasurer;

  constructor(options: SceneSessionOptions = {}) {
    this.rootDir = options.rootDir ? resolve(options.rootDir) : null;
    this.measurer = options.measurer ?? createApproximateTextMeasurer();
  }

  /** The active page's live scene — the one object every element/diagram/export tool operates on. */
  get scene(): Scene {
    const page = this.pages[this.activeIndex];
    if (!page) throw new Error("scene-session: active page index out of range (bug)");
    return page.scene;
  }

  get activePage(): ScenePage {
    const page = this.pages[this.activeIndex];
    if (!page) throw new Error("scene-session: active page index out of range (bug)");
    return page;
  }

  get pageCount(): number {
    return this.pages.length;
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

  /** Discards the current document and starts a fresh, unbound single-page scene. */
  newScene(): void {
    this.pages = [freshPage()];
    this.activeIndex = 0;
    this.boundPath = null;
    this.sourceIsMultiPage = false;
  }

  openScene(path: string): OpenSceneResult {
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

    this.pages = result.pages;
    const activeIndex = result.activePageId === null ? 0 : result.pages.findIndex((page) => page.id === result.activePageId);
    this.activeIndex = activeIndex === -1 ? 0 : activeIndex;
    this.boundPath = resolved;
    this.sourceIsMultiPage = typeof raw === "object" && raw !== null && (raw as Record<string, unknown>).type === MULTI_PAGE_DOCUMENT_TYPE;
    return {
      path: resolved,
      pageCount: this.pages.length,
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
      this.sourceIsMultiPage || this.pages.length > 1
        ? serializeMultiPageDocument(this.pages, { activePageId: this.activePage.id, includeDeleted: true })
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
