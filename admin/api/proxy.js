/* global Buffer, process */

const REQUEST_HEADERS_TO_DROP = new Set([
  'connection',
  'content-length',
  'host',
  'transfer-encoding',
]);

const RESPONSE_HEADERS_TO_DROP = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'transfer-encoding',
]);

function getUpstreamBaseUrl() {
  const configuredUrl = process.env.SENTRY_API_URL?.trim();
  if (!configuredUrl) {
    throw new Error('SENTRY_API_URL is not configured');
  }

  const upstream = new URL(configuredUrl);
  if (upstream.protocol !== 'https:' && upstream.protocol !== 'http:') {
    throw new Error('SENTRY_API_URL must use http or https');
  }

  upstream.search = '';
  upstream.hash = '';
  upstream.pathname = upstream.pathname.replace(/\/+$/, '');
  return upstream;
}

function buildUpstreamUrl(request) {
  const requestUrl = new URL(
    request.url,
    `https://${request.headers.host || 'sentry-admin.local'}`,
  );
  const rewrittenPath = request.query?.path;
  const apiPath = (Array.isArray(rewrittenPath)
    ? rewrittenPath.join('/')
    : rewrittenPath || requestUrl.pathname.replace(/^\/api\/?/, '')
  ).replace(/^\/+/, '');
  requestUrl.searchParams.delete('path');
  const upstream = getUpstreamBaseUrl();
  upstream.pathname = `${upstream.pathname}/api/${apiPath}`.replace(/\/{2,}/g, '/');
  upstream.search = requestUrl.search;
  return upstream;
}

async function getRequestBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return undefined;
  }

  if (request.body !== undefined && request.body !== null) {
    if (Buffer.isBuffer(request.body) || typeof request.body === 'string') {
      return request.body;
    }

    return JSON.stringify(request.body);
  }

  if (request.readableEnded) {
    return undefined;
  }

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

function buildUpstreamHeaders(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (REQUEST_HEADERS_TO_DROP.has(name.toLowerCase()) || value === undefined) {
      continue;
    }
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }

  headers.set('x-forwarded-host', request.headers.host || '');
  headers.set('x-forwarded-proto', 'https');
  return headers;
}

function copyResponseHeaders(upstreamResponse, response) {
  for (const [name, value] of upstreamResponse.headers.entries()) {
    if (
      name.toLowerCase() === 'set-cookie'
      || RESPONSE_HEADERS_TO_DROP.has(name.toLowerCase())
    ) {
      continue;
    }
    response.setHeader(name, value);
  }

  const cookies = upstreamResponse.headers.getSetCookie?.()
    || (upstreamResponse.headers.get('set-cookie')
      ? [upstreamResponse.headers.get('set-cookie')]
      : []);
  if (cookies.length > 0) {
    response.setHeader('set-cookie', cookies);
  }
}

export default async function handler(request, response) {
  let upstreamUrl;
  try {
    upstreamUrl = buildUpstreamUrl(request);
  } catch (error) {
    response.status(503).json({
      error: 'Sentry WMS API proxy is not configured',
      detail: error.message,
    });
    return;
  }

  try {
    const body = await getRequestBody(request);
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: buildUpstreamHeaders(request),
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(25_000),
    });

    copyResponseHeaders(upstreamResponse, response);
    const payload = Buffer.from(await upstreamResponse.arrayBuffer());
    response.status(upstreamResponse.status).send(payload);
  } catch (error) {
    response.status(502).json({
      error: 'Sentry WMS API is unavailable',
      detail: error.message,
    });
  }
}

export {
  buildUpstreamUrl,
  getRequestBody,
  getUpstreamBaseUrl,
};
