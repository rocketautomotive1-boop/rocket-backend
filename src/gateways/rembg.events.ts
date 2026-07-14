/**
 * Internal (in-process) events for the rembg gateway ↔ completion-service edge.
 *
 * The gateway emits SUBSCRIBED when a client joins a product's room so the
 * completion service can replay the current batch state to that room (self-healing
 * reconnect). Routing this through EventEmitter2 keeps the gateway free of a direct
 * dependency on RembgCompletionService — which already depends on the gateway — and
 * so avoids a module cycle.
 */
export const REMBG_EVENTS = {
  SUBSCRIBED: 'rembg.subscribed',
} as const;

export interface RembgSubscribedEvent {
  productId: string;
}
