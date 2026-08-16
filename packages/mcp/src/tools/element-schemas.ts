/**
 * zod input schemas bridging agent JSON to the engine's element creation/update surface. Two rules
 * govern every field here: (1) only properties the engine's factories/`updateElement` whitelist can
 * accept are exposed — store-owned fields (`version`, `index`, ids) are never agent-settable; and
 * (2) constraint messages are written for the AGENT (actionable, naming the field and the fix),
 * since a model reads these verbatim when a call is rejected.
 */
import { z } from "zod";

const finite = z.number().finite();

/** Style + orientation fields shared by every creatable/updatable element — mirrors `BaseElement`'s user-styled subset. */
export const styleShape = {
  strokeColor: z.string().max(64).optional().describe("CSS color, e.g. \"#1e1e1e\""),
  backgroundColor: z.string().max(64).optional().describe("CSS color or \"transparent\""),
  fillStyle: z.enum(["hachure", "cross-hatch", "solid", "zigzag"]).optional(),
  strokeWidth: finite.min(0.1).max(50).optional(),
  strokeStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
  roughness: finite.min(0).max(3).optional().describe("hand-drawn sketchiness; 0 = clean lines"),
  opacity: finite.min(0).max(100).optional(),
  angle: finite.optional().describe("rotation in radians"),
  locked: z.boolean().optional(),
};

const positionShape = { x: finite.describe("scene x of the element's top-left origin"), y: finite.describe("scene y of the element's top-left origin") };
const sizeShape = {
  width: finite.positive().max(1_000_000).optional(),
  height: finite.positive().max(1_000_000).optional(),
};

/** A vertex relative to the element's own (x, y) origin, scene units. */
export const pointSchema = z.object({ x: finite, y: finite });

const labelShape = { label: z.string().max(2000).optional().describe("text placed inside the shape (auto-wrapped and centered)") };

/** One labeled container shape — the four types here must stay a subset of the engine's `BINDABLE_CONTAINER_TYPES`. */
function labeledContainerSchema<Type extends string>(type: Type) {
  return z.object({ type: z.literal(type), ...positionShape, ...sizeShape, ...styleShape, ...labelShape });
}

const arrowheadSchema = z.enum(["none", "arrow", "bar", "dot", "triangle"]);

export const createElementSchema = z.discriminatedUnion("type", [
  labeledContainerSchema("rectangle"),
  labeledContainerSchema("ellipse"),
  labeledContainerSchema("diamond"),
  labeledContainerSchema("note"),
  z.object({ type: z.literal("frame"), ...positionShape, ...sizeShape, ...styleShape, name: z.string().max(200).optional() }),
  z.object({
    type: z.literal("line"),
    ...positionShape,
    ...styleShape,
    points: z.array(pointSchema).min(2).max(1000).describe("vertices relative to (x, y); repeat the first point last to close a polygon"),
  }),
  z.object({
    type: z.literal("arrow"),
    ...positionShape,
    ...styleShape,
    points: z.array(pointSchema).min(2).max(1000).describe("vertices relative to (x, y), tail first, head last"),
    startArrowhead: arrowheadSchema.optional(),
    endArrowhead: arrowheadSchema.optional(),
    arrowType: z.enum(["straight", "curved", "elbow"]).optional(),
  }),
  z.object({
    type: z.literal("text"),
    ...positionShape,
    ...styleShape,
    text: z.string().min(1).max(10_000),
    fontSize: finite.min(4).max(400).optional(),
    textAlign: z.enum(["left", "center", "right"]).optional(),
    fontFamily: z.enum(["hand-drawn-slot", "normal", "code"]).optional().describe("hand-drawn (default), sans-serif, or monospace"),
  }),
  z.object({
    type: z.literal("freedraw"),
    ...positionShape,
    ...styleShape,
    points: z.array(pointSchema).min(2).max(10_000).describe("ink stroke samples relative to (x, y)"),
  }),
]);

export type CreateElementInput = z.output<typeof createElementSchema>;

/**
 * The mutable-property whitelist for `update_elements` — geometry, style, text/label, plus
 * `points` for the point-geometry types. Cross-type misuse (e.g. `text` on a rectangle) is
 * rejected by the handler with a targeted message, not silently dropped.
 */
export const updateElementSchema = z.object({
  id: z.string().min(1),
  x: finite.optional(),
  y: finite.optional(),
  width: finite.positive().max(1_000_000).optional(),
  height: finite.positive().max(1_000_000).optional(),
  ...styleShape,
  text: z.string().max(10_000).optional().describe("text elements only: replaces the element's text"),
  label: z.string().max(2000).optional().describe("rectangle/ellipse/diamond/note only: sets the bound label text"),
  points: z.array(pointSchema).min(2).max(10_000).optional().describe("line/arrow/freedraw only: replaces the vertex list"),
});

export type UpdateElementInput = z.output<typeof updateElementSchema>;
