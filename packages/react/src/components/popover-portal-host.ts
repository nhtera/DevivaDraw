/**
 * Where a portalled popover mounts: the `<DevivaDraw/>` root element, never `document.body`.
 *
 * Every chrome style resolves through CSS custom properties (`--dd-chrome-background-elevated`,
 * `--dd-text-primary`, …) that `deviva-draw-shell.tsx` sets **on the root element**. A popover portalled
 * to `document.body` sits outside that subtree, so those variables are undefined for it and each one
 * falls back to nothing — the panel background resolves to transparent and the popover renders as
 * unreadable floating controls over whatever is behind it.
 *
 * Mounting inside the root keeps the variables in scope while still escaping the properties panel's
 * scroll container (which clips `position: absolute` children). `position: fixed` children stay
 * viewport-positioned here because the root establishes no transform/filter/perspective containing
 * block — if that ever changes, fixed-position popovers would start resolving against the root instead,
 * and this is the one place to fix it.
 */

/** The app root containing `node`, or `document.body` as a last resort if it is somehow unparented. */
export function popoverPortalHost(node: Element | null | undefined): HTMLElement {
  return node?.closest<HTMLElement>('[data-testid="deviva-draw-root"]') ?? document.body;
}
