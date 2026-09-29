export type RuntimeConfig = {
  apiBaseUrl: string;
  uacBaseUrl: string;
};

function baseUrl(value: unknown, name: string, allowSameOrigin: boolean): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a URL string`);
  const url = value.trim();
  if (allowSameOrigin && url === '') return '';
  if (url.startsWith('/') && !url.startsWith('//')) {
    if (url.includes('\\')) throw new Error(`${name} must not contain a backslash`);
    const parsed = new URL(url, location.origin);
    if (parsed.origin !== location.origin || parsed.search || parsed.hash)
      throw new Error(`${name} must be a same-origin path without query or fragment`);
    return parsed.pathname.replace(/\/+$/, '') || '';
  }
  let parsed: URL;
  try { parsed = new URL(url); }
  catch { throw new Error(`${name} must be an absolute HTTP(S) URL or a same-origin path`); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error(`${name} must be an HTTP(S) URL without credentials, query, or fragment`);
  if (location.protocol === 'https:' && parsed.protocol !== 'https:')
    throw new Error(`${name} must use HTTPS on an HTTPS page`);
  return parsed.href.replace(/\/+$/, '');
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch('/assets/config.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`config.json returned HTTP ${response.status}`);
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('config.json must contain an object');
  const config = value as Record<string, unknown>;
  return {
    apiBaseUrl: baseUrl(config['apiBaseUrl'], 'apiBaseUrl', true),
    uacBaseUrl: baseUrl(config['uacBaseUrl'], 'uacBaseUrl', false)
  };
}
