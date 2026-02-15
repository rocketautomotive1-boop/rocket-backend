import { createHmac } from 'crypto'

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

export function getPartnerId(): string {
  return process.env.SHOPEE_PARTNER_ID as string
}

export function getPartnerKey(): string {
  return process.env.SHOPEE_PARTNER_KEY as string
}

export function generateSignature(path: string, timestamp: number, accessToken?: string, shopId?: string): string {
  const partnerId = getPartnerId()
  const partnerKey = getPartnerKey()
  const fullPath = path.startsWith('/api/v2') ? path : `/api/v2${path}`
  const base = accessToken && shopId
    ? `${partnerId}${fullPath}${timestamp}${accessToken}${shopId}`
    : `${partnerId}${fullPath}${timestamp}`
  return createHmac('sha256', partnerKey).update(base).digest('hex')
}

export function buildHeaders(accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  return headers
}

export function buildSignedParams(path: string, timestamp: number, accessToken?: string, shopId?: string | number, extra?: Record<string, any>): Record<string, any> {
  const params: Record<string, any> = {
    partner_id: parseInt(String(getPartnerId())),
    timestamp,
    sign: generateSignature(path, timestamp, accessToken, (shopId !== undefined && shopId !== null) ? String(shopId) : undefined),
  }
  if (accessToken) params['access_token'] = accessToken
  if (shopId !== undefined && shopId !== null) {
    const normalizedShopId = parseInt(String(shopId))
    params['shop_id'] = isNaN(normalizedShopId) ? shopId : normalizedShopId
  }
  if (extra) Object.assign(params, extra)
  return params
}

export function buildAuthUrl(redirect: string): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const path = '/api/v2/shop/auth_partner'
  const params = new URLSearchParams({
    partner_id: getPartnerId(),
    timestamp: String(timestamp),
    sign: generateSignature(path, timestamp),
    redirect,
  })
  return `${getShopeeHost()}${path}?${params.toString()}`
}

export function getSignatureBaseString(path: string, timestamp: number, accessToken?: string, shopId?: string): string {
  const partnerId = getPartnerId()
  const fullPath = path.startsWith('/api/v2') ? path : `/api/v2${path}`
  return accessToken && shopId
    ? `${partnerId}${fullPath}${timestamp}${accessToken}${shopId}`
    : `${partnerId}${fullPath}${timestamp}`
}