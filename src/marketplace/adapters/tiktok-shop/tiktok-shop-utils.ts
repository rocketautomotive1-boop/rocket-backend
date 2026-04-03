import { createHmac } from 'crypto';

export function getTikTokShopBaseUrl(): string {
  return process.env.TIKTOK_SHOP_ENV === 'sandbox'
    ? 'https://open-api-sandbox.tiktokglobalshop.com'
    : 'https://open-api.tiktokglobalshop.com';
}

export function getAppKey(): string {
  return process.env.TIKTOK_SHOP_APP_KEY as string;
}

export function getAppSecret(): string {
  return process.env.TIKTOK_SHOP_APP_SECRET as string;
}

/**
 * TikTok Shop signature algorithm:
 * 1. Extract all query params (excluding sign, access_token)
 * 2. Sort params alphabetically by key
 * 3. Concatenate: path + sorted key-value pairs + body string
 * 4. Wrap with app_secret: app_secret + content + app_secret
 * 5. HMAC-SHA256 with app_secret as key
 */
export function generateSignature(
  path: string,
  params: Record<string, any>,
  body?: string,
): string {
  const appSecret = getAppSecret();

  // Filter out sign and access_token from params for signing
  const filteredParams = { ...params };
  delete filteredParams['sign'];
  delete filteredParams['access_token'];

  // Sort params by key
  const sortedKeys = Object.keys(filteredParams).sort();
  const paramString = sortedKeys.map((key) => `${key}${filteredParams[key]}`).join('');

  // Build base string: path + sorted params + body
  const content = `${path}${paramString}${body || ''}`;

  // Wrap with app_secret
  const wrappedContent = `${appSecret}${content}${appSecret}`;

  return createHmac('sha256', appSecret).update(wrappedContent).digest('hex');
}

export function buildSignedParams(
  path: string,
  timestamp: number,
  accessToken?: string,
  shopCipher?: string,
  extra?: Record<string, any>,
  body?: string,
): Record<string, any> {
  const params: Record<string, any> = {
    app_key: getAppKey(),
    timestamp,
  };

  if (shopCipher) params['shop_cipher'] = shopCipher;
  if (extra) Object.assign(params, extra);

  // Generate signature with all params except sign and access_token
  params['sign'] = generateSignature(path, params, body);

  // Add access_token after signing (excluded from signature)
  if (accessToken) params['access_token'] = accessToken;

  return params;
}

export function buildHeaders(accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-tts-access-token': accessToken || '',
  };
  return headers;
}

export function buildAuthUrl(redirectUri: string): string {
  const appKey = getAppKey();
  const state = `tiktokshop_${Date.now()}`;

  const params = new URLSearchParams({
    app_key: appKey,
    state,
  });

  return `https://services.tiktokshop.com/open/authorize?${params.toString()}`;
}

export function getAuthTokenUrl(): string {
  return `${getTikTokShopBaseUrl()}/api/v2/token/get`;
}

export function getRefreshTokenUrl(): string {
  return `${getTikTokShopBaseUrl()}/api/v2/token/refresh`;
}
