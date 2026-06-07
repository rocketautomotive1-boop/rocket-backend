import { MarketplaceDocument } from '../../schemas/marketplace.schema';

export function resolveRedirectUri(
  marketplace: Pick<MarketplaceDocument, 'settings'> | null | undefined,
  envFallback?: string,
): string {
  const fromSettings = (marketplace?.settings as any)?.redirectUri;
  return (fromSettings && String(fromSettings)) || envFallback || '';
}
