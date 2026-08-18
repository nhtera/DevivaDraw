/**
 * The comments panel: every thread on the page, unresolved first, with a resolved filter and
 * click-to-reveal. This is where a `page`-anchored thread and a resolved one live — neither has a
 * canvas pin, so without the panel they would be unreachable.
 *
 * Talks to `Scene` directly with a subscribe/bump re-render, the layers-panel interaction model.
 * View-only safety is not this component's job either: the shell unmounts it in the surfaces where
 * commenting is not allowed, so no per-control guard can be forgotten here.
 */
import { resolveCommentAnchor } from "@deviva-draw/engine";
import { useEffect, useReducer, useState } from "react";
import { buttonStyle, chromeFontFamily, inputStyle, labelStyle, panelStyle } from "../chrome-styles";
import { Icon } from "../icon";
import { useTranslation } from "../../i18n/use-translation";
import type { DevivaRuntime } from "../../runtime/runtime-types";
import { getCommentAuthor, setCommentAuthorName } from "./comment-author";

/** Half-width of the box the camera reveals around a pin — enough context around the anchor that the reader sees what the thread is about. */
const REVEAL_HALF_SIZE = 200;

export interface CommentsPanelProps {
  runtime: DevivaRuntime;
  /** Opens the thread's popover on the canvas after revealing it. */
  onOpenThread(threadId: string): void;
}

export function CommentsPanel(props: CommentsPanelProps) {
  const { runtime, onOpenThread } = props;
  const scene = runtime.scene;
  const { t } = useTranslation();
  const [showResolved, setShowResolved] = useState(false);
  const [nameDraft, setNameDraft] = useState(() => getCommentAuthor().name);
  const [, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => scene.subscribe(() => bump()), [scene]);

  const threads = scene
    .getCommentThreads()
    .filter((thread) => showResolved || !thread.resolved)
    // Unresolved first, then newest first inside each group — an open question outranks a finished one.
    .sort((a, b) => Number(a.resolved) - Number(b.resolved) || b.created - a.created);

  // Renaming rewrites the local author's existing records too, so a board does not end up showing
  // the same person under two names. Those rewrites are ordinary version bumps, so they flush onto
  // the wire like any other comment change.
  const commitName = () => {
    const trimmed = nameDraft.trim();
    if (trimmed === "" || trimmed === getCommentAuthor().name) {
      setNameDraft(getCommentAuthor().name);
      return;
    }
    setCommentAuthorName(trimmed);
    scene.renameCommentAuthor(getCommentAuthor().id, trimmed);
  };

  const reveal = (threadId: string) => {
    const thread = scene.getCommentThread(threadId);
    if (!thread) return;
    const point = resolveCommentAnchor(thread.anchor, scene);
    // A page-anchored thread has nowhere to fly to; opening it is still the right response.
    if (point) {
      runtime.panZoomTool.revealRect({ x: point.x - REVEAL_HALF_SIZE, y: point.y - REVEAL_HALF_SIZE, width: REVEAL_HALF_SIZE * 2, height: REVEAL_HALF_SIZE * 2 });
    }
    onOpenThread(threadId);
  };

  return (
    <div
      data-testid="comments-panel"
      style={{
        ...panelStyle,
        position: "absolute",
        top: 76,
        right: "calc(8px + var(--dd-library-sidebar-width, 0px))",
        width: 220,
        maxHeight: "calc(100vh - 140px)",
        overflowY: "auto",
        padding: 6,
        zIndex: 25,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontFamily: chromeFontFamily,
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 12 }}>{t("comments.title")}</strong>
        <button
          type="button"
          data-testid="comments-toggle-resolved"
          aria-pressed={showResolved}
          title={t("comments.showResolved")}
          style={buttonStyle(showResolved)}
          onClick={() => setShowResolved(!showResolved)}
        >
          <Icon name="check" size={12} />
        </button>
      </div>

      <div style={{ padding: "2px 4px 6px" }}>
        <label style={labelStyle} htmlFor="deviva-comment-author-name">
          {t("comments.commentingAs")}
        </label>
        <input
          id="deviva-comment-author-name"
          data-testid="comments-author-name"
          value={nameDraft}
          maxLength={64}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            event.stopPropagation(); // chrome input, never a canvas shortcut
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          style={{ ...inputStyle, fontSize: 12, padding: "5px 8px" }}
        />
      </div>

      {threads.length === 0 && <span style={{ opacity: 0.7, padding: "6px 4px" }}>{t("comments.none")}</span>}

      {threads.map((thread) => {
        const messages = scene.getCommentMessages(thread.id);
        return (
          <button
            key={thread.id}
            type="button"
            data-testid={`comments-panel-thread-${thread.id}`}
            onClick={() => reveal(thread.id)}
            style={{
              ...buttonStyle(),
              width: "100%",
              justifyContent: "flex-start",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 2,
              padding: "6px 8px",
              height: "auto",
              textAlign: "left",
              opacity: thread.resolved ? 0.6 : 1,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600 }}>
              {thread.authorName}
              {thread.resolved ? ` · ${t("comments.resolvedThread")}` : ""}
            </span>
            <span style={{ fontSize: 11, opacity: 0.85, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%" }}>
              {messages[0]?.body ?? t("comments.empty")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
