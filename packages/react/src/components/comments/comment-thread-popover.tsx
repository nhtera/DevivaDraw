/**
 * One open comment thread: its messages, a composer, and the resolve/delete controls. Positioned
 * beside its pin in screen space by the caller, and — like the pins overlay — a sibling of the canvas
 * host so typing in here never reaches the engine's pointer/keyboard pipeline.
 *
 * The author-only edit/delete rule is enforced by the store (`SceneCommentsStore.editMessage`), not
 * here; this component only decides whether to OFFER the control. Both layers matter: hiding a
 * button the store would refuse anyway keeps the UI honest, and the store check keeps a non-UI host
 * (or a hand-crafted call) from bypassing it.
 */
import { createCommentMessage } from "@deviva-draw/engine";
import type { CommentThread, Scene } from "@deviva-draw/engine";
import { useState } from "react";
import { Icon } from "../icon";
import { buttonStyle, chromeFontFamily, panelStyle } from "../chrome-styles";
import { useTranslation } from "../../i18n/use-translation";
import { getCommentAuthor } from "./comment-author";

const POPOVER_WIDTH = 260;

export interface CommentThreadPopoverProps {
  scene: Scene;
  thread: CommentThread;
  /** Top-left screen position, computed by the caller from the thread's resolved anchor. */
  position: { x: number; y: number };
  /** A read-only surface (the share viewer) shows the conversation but cannot add to it. */
  readOnly?: boolean;
  onClose(): void;
}

export function CommentThreadPopover(props: CommentThreadPopoverProps) {
  const { scene, thread, position, readOnly = false, onClose } = props;
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const author = getCommentAuthor();
  const messages = scene.getCommentMessages(thread.id);

  const submit = () => {
    const body = draft.trim();
    if (body === "" || readOnly) return;
    scene.addCommentMessage(createCommentMessage({ threadId: thread.id, body, authorId: author.id, authorName: author.name }));
    setDraft("");
  };

  return (
    <div
      data-testid={`comment-thread-${thread.id}`}
      style={{ ...panelStyle, position: "absolute", left: position.x, top: position.y, width: POPOVER_WIDTH, display: "flex", flexDirection: "column", gap: 8, padding: 10, zIndex: 20, fontFamily: chromeFontFamily, fontSize: 12 }}
      // Keys typed in the composer are chrome input, never canvas shortcuts.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{thread.resolved ? t("comments.resolvedThread") : t("comments.thread")}</span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            data-testid={`comment-resolve-${thread.id}`}
            title={thread.resolved ? t("comments.unresolve") : t("comments.resolve")}
            style={buttonStyle()}
            disabled={readOnly}
            onClick={() => scene.setCommentThreadResolved(thread.id, !thread.resolved)}
          >
            <Icon name="check" size={12} />
          </button>
          <button
            type="button"
            data-testid={`comment-delete-thread-${thread.id}`}
            title={t("comments.deleteThread")}
            style={buttonStyle()}
            disabled={readOnly}
            onClick={() => {
              scene.deleteCommentThread(thread.id);
              onClose();
            }}
          >
            <Icon name="trash" size={12} />
          </button>
          <button type="button" data-testid={`comment-close-${thread.id}`} title={t("comments.close")} style={buttonStyle()} onClick={onClose}>
            <Icon name="close" size={12} />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
        {messages.length === 0 && <span style={{ fontSize: 12, opacity: 0.7 }}>{t("comments.empty")}</span>}
        {messages.map((message) => (
          <div key={message.id} data-testid={`comment-message-${message.id}`} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600 }}>{message.authorName}</span>
              {message.authorId === author.id && !readOnly && (
                <button
                  type="button"
                  data-testid={`comment-delete-message-${message.id}`}
                  title={t("comments.deleteMessage")}
                  style={{ ...buttonStyle(), width: 20, height: 20 }}
                  onClick={() => scene.deleteCommentMessage(message.id, author.id)}
                >
                  <Icon name="trash" size={10} />
                </button>
              )}
            </div>
            <span style={{ fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{message.body}</span>
          </div>
        ))}
      </div>

      {readOnly ? (
        <span style={{ fontSize: 11, opacity: 0.7 }}>{t("comments.readOnlyHint")}</span>
      ) : (
        <textarea
          data-testid={`comment-composer-${thread.id}`}
          value={draft}
          placeholder={t("comments.composerPlaceholder")}
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
          // Enter sends, Shift+Enter starts a new line — the convention every chat composer uses, so
          // the common case (a one-line reply) needs no reach for a button.
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            event.preventDefault();
            submit();
          }}
          style={{
            width: "100%",
            resize: "vertical",
            fontSize: 12,
            fontFamily: "inherit",
            padding: 6,
            borderRadius: 6,
            border: "1px solid var(--dd-chrome-border)",
            background: "var(--dd-chrome-background)",
            color: "inherit",
            boxSizing: "border-box",
          }}
        />
      )}
    </div>
  );
}
