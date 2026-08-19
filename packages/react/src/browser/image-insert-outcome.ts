/**
 * What happened to an image the user tried to insert, in the shape the chrome needs to say something
 * true about it.
 *
 * This replaced an `onInsertError(error: unknown)` callback whose only two implementations were
 * `console.warn` — so an image that was refused looked, on screen, exactly like an image that was
 * ignored. The callback also could not express the outcome that matters most now: "it worked, but I
 * resized it". An outcome type can, which is why the seam changed shape rather than just gaining a
 * consumer.
 */
import { ImageFileTooLargeError, ImagePixelLimitError } from "@deviva-draw/engine";
import type { ImageResizedInfo } from "@deviva-draw/engine";

export type ImageInsertOutcome =
  | { kind: "resized"; resized: ImageResizedInfo }
  /** Each rejection carries what the message needs to be specific: the byte limit that was hit, or the dimensions that were refused. */
  | { kind: "rejected"; reason: "too-large"; limitBytes: number }
  | { kind: "rejected"; reason: "too-many-pixels"; width: number; height: number }
  | { kind: "rejected"; reason: "undecodable" };

/** Classifies whatever `insertImageFile` threw into an outcome the notice can render. */
export function outcomeFromInsertError(error: unknown): ImageInsertOutcome {
  if (error instanceof ImageFileTooLargeError) return { kind: "rejected", reason: "too-large", limitBytes: error.maxSizeBytes };
  if (error instanceof ImagePixelLimitError) return { kind: "rejected", reason: "too-many-pixels", width: error.width, height: error.height };
  // A decode failure, a canvas the browser refused to re-encode, an unreadable file — all the same
  // to the user: this image did not go in. The detail still reaches the console for a bug report.
  return { kind: "rejected", reason: "undecodable" };
}

/**
 * The one place an insert failure is turned into an outcome and reported. Also keeps the raw error
 * in the console: the notice tells the user what happened, the console still tells whoever is
 * debugging *why* — the old behaviour was to do only the second and call it done.
 */
export function reportInsertFailure(error: unknown, report: ((outcome: ImageInsertOutcome) => void) | undefined): void {
  console.warn("deviva-draw: image insert failed", error);
  report?.(outcomeFromInsertError(error));
}
