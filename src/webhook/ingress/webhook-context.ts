import { WebhookContext } from '../adapters/webhook-adapter.interface';

export function buildWebhookContext(req: any): WebhookContext {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers || {})) headers[k.toLowerCase()] = v as string;
  return {
    marketplace: String(req.params?.marketplace || '').toLowerCase(),
    topic: String(req.params?.topic || req.body?.topic || 'unknown'),
    headers,
    rawBody: req.rawBody,
    payload: req.body,
  };
}
