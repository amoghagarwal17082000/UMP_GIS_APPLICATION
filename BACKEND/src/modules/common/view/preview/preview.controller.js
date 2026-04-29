const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');

const ALLOWED_HOSTS = new Set(['irgeoportal.gov.in', 'www.irgeoportal.gov.in']);
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);

function getExtension(pathname) {
  const match = String(pathname || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return match ? match[0] : '';
}

function contentTypeFor(ext) {
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function validatePreviewUrl(rawUrl) {
  const target = new URL(String(rawUrl || ''));
  const host = target.hostname.toLowerCase();
  const ext = getExtension(target.pathname);

  if (!['http:', 'https:'].includes(target.protocol)) {
    throw Object.assign(new Error('Unsupported preview protocol'), { statusCode: 400 });
  }

  if (!ALLOWED_HOSTS.has(host)) {
    throw Object.assign(new Error('Preview host not allowed'), { statusCode: 400 });
  }

  if (!target.pathname.toLowerCase().startsWith('/offtrack/landplans/')) {
    throw Object.assign(new Error('Preview path not allowed'), { statusCode: 400 });
  }

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw Object.assign(new Error('Preview file type not allowed'), { statusCode: 400 });
  }

  return { target, ext };
}

function getProxyUrl() {
  const rawProxy = process.env.IRGEOPORTAL_PROXY_URL
    || process.env.HTTPS_PROXY
    || process.env.HTTP_PROXY
    || process.env.https_proxy
    || process.env.http_proxy;

  if (!rawProxy) return null;

  try {
    const value = String(rawProxy).trim();
    return new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);
  } catch {
    return null;
  }
}

function proxyAuthorizationHeader(proxyUrl) {
  if (!proxyUrl.username && !proxyUrl.password) return null;
  const username = decodeURIComponent(proxyUrl.username || '');
  const password = decodeURIComponent(proxyUrl.password || '');
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

function createHttpsProxyConnection(target, proxyUrl, callback) {
  const proxyPort = Number(proxyUrl.port || 80);
  const targetPort = Number(target.port || 443);
  const socket = net.connect(proxyPort, proxyUrl.hostname);
  const authHeader = proxyAuthorizationHeader(proxyUrl);
  let response = Buffer.alloc(0);
  let settled = false;

  function settle(err, secureSocket) {
    if (settled) return;
    settled = true;
    socket.removeAllListeners('error');
    socket.removeAllListeners('data');
    callback(err, secureSocket);
  }

  socket.once('connect', () => {
    const headers = [
      `CONNECT ${target.hostname}:${targetPort} HTTP/1.1`,
      `Host: ${target.hostname}:${targetPort}`,
      'Proxy-Connection: Keep-Alive',
    ];
    if (authHeader) headers.push(`Proxy-Authorization: ${authHeader}`);
    socket.write(`${headers.join('\r\n')}\r\n\r\n`);
  });

  socket.on('data', (chunk) => {
    response = Buffer.concat([response, chunk]);
    const headerEnd = response.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;

    const headerText = response.slice(0, headerEnd).toString('latin1');
    const statusMatch = headerText.match(/^HTTP\/\d(?:\.\d)?\s+(\d+)/i);
    const statusCode = statusMatch ? Number(statusMatch[1]) : 0;

    if (statusCode !== 200) {
      socket.destroy();
      settle(new Error(`Proxy CONNECT failed (${statusCode || 'unknown'})`));
      return;
    }

    const secureSocket = tls.connect({
      socket,
      servername: target.hostname,
      rejectUnauthorized: false,
    });
    secureSocket.once('secureConnect', () => settle(null, secureSocket));
    secureSocket.once('error', (err) => settle(err));
  });

  socket.once('error', (err) => settle(err));
}

function requestOptionsFor(target) {
  const proxyUrl = getProxyUrl();
  const isHttps = target.protocol === 'https:';
  const headers = {
    'User-Agent': 'Mozilla/5.0 UMP-GIS LandPlanPreview/1.0',
    'Accept': 'application/pdf,image/*,*/*;q=0.8',
  };

  if (!proxyUrl) {
    return {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      rejectUnauthorized: false,
      headers,
    };
  }

  if (!isHttps) {
    const authHeader = proxyAuthorizationHeader(proxyUrl);
    if (authHeader) headers['Proxy-Authorization'] = authHeader;
    return {
      protocol: 'http:',
      hostname: proxyUrl.hostname,
      port: proxyUrl.port || 80,
      path: target.toString(),
      headers,
    };
  }

  return {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || 443,
    path: `${target.pathname}${target.search}`,
    rejectUnauthorized: false,
    headers,
    createConnection: (_options, callback) => createHttpsProxyConnection(target, proxyUrl, callback),
  };
}

function streamRemoteFile(target, ext, res, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const client = target.protocol === 'https:' ? https : http;
    const request = client.get(requestOptionsFor(target), (upstream) => {
      const statusCode = upstream.statusCode || 0;
      const location = upstream.headers.location;

      if ([301, 302, 303, 307, 308].includes(statusCode) && location && redirectCount < 5) {
        upstream.resume();
        const redirected = new URL(location, target);
        streamRemoteFile(redirected, ext, res, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        upstream.resume();
        reject(Object.assign(new Error(`Unable to load preview (${statusCode})`), { statusCode: statusCode || 502 }));
        return;
      }

      res.setHeader('Content-Type', upstream.headers['content-type'] || contentTypeFor(ext));
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.removeHeader('X-Frame-Options');
      res.removeHeader('Content-Security-Policy');

      upstream.pipe(res);
      upstream.on('end', resolve);
      upstream.on('error', reject);
    });

    request.setTimeout(30000, () => {
      request.destroy(new Error('Preview request timed out'));
    });
    request.on('error', reject);
  });
}

async function previewLandPlan(req, res, next) {
  try {
    const { target, ext } = validatePreviewUrl(req.query.url);
    await streamRemoteFile(target, ext, res);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).send(err.message);
    }
    return next(err);
  }
}

module.exports = { previewLandPlan };
