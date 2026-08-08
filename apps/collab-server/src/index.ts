/**
 * Collaboration backend for Deviva Draw. Durable Objects room coordination
 * and R2-backed share-link storage arrive with the collab and share-link
 * phases; until then this Worker only answers health checks.
 */
export default {
  async fetch(): Promise<Response> {
    return new Response("deviva-draw-collab ok", { status: 200 });
  },
} satisfies ExportedHandler;
