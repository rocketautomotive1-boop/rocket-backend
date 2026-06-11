export function getShopeeBaseUrl(): string {
  return (process.env.SHOPEE_ENV === 'sandbox' || process.env.SHOPEE_USE_SANDBOX === 'true')
    ? 'https://openplatform.sandbox.test-stable.shopee.sg/api/v2'
    : 'https://partner.shopeemobile.com/api/v2'
}

export function getShopeeHost(): string {
  if (process.env.SHOPEE_HOST) return process.env.SHOPEE_HOST
  return (process.env.SHOPEE_ENV === 'sandbox' || process.env.SHOPEE_USE_SANDBOX === 'true')
    ? 'https://openplatform.sandbox.test-stable.shopee.sg'
    : 'https://partner.shopeemobile.com'
}

export function buildHeaders(accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  return headers
}
