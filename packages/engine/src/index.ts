/**
 * @deviva-draw/engine — framework-agnostic whiteboard core.
 *
 * Populated across the implementation phases: element model, scene store,
 * history, renderer, geometry, input/tools state machine, bindings,
 * serializers. This entry point re-exports the public engine API.
 */
export const ENGINE_VERSION = "0.1.0";

export type {
  BaseElement,
  BoundElementRef,
  FillStyle,
  RoundnessValue,
  StrokeStyle,
} from "./elements/base-element";
export type { AnyElement, ElementCreationInput, GenericElement } from "./elements/element-types";
export { createGenericElement } from "./elements/element-types";

export type { IndexedItem } from "./scene/fractional-index";
export { indexBetween, moveBackward, moveForward, moveToBack, moveToFront } from "./scene/fractional-index";
export { randomVersionNonce, touch } from "./scene/scene-mutations";
export type { ElementUpdate, SceneListener } from "./scene/scene";
export { Scene } from "./scene/scene";

export type { HistoryStackOptions } from "./history/history-stack";
export { HistoryStack } from "./history/history-stack";
