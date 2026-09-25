// Tydom local button pairing: for a short while after a press on the
// gateway's button it opens an unauthenticated websocket route that returns
// the gateway's own password. Port of the Home Assistant Tydom integration's
// async_read_local_gateway_password. Never log the returned password.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebSocket = require('ws');

const PASSWORD_URI = '/configs/gateway/password';
const ATTEMPT_TIMEOUT_MS = 6000;

// Pull `current` out of the HTTP-over-websocket response for PASSWORD_URI.
const extractPassword = (buf: Buffer): string | null => {
  const text = buf.toString('latin1');
  const headerEnd = text.indexOf('\r\n\r\n');
  if (headerEnd < 0 || !text.includes(PASSWORD_URI)) return null;
  let body = text.slice(headerEnd + 4);
  if (/transfer-encoding:\s*chunked/i.test(text.slice(0, headerEnd))) {
    const chunks: string[] = [];
    let cursor = 0;
    for (;;) {
      const lineEnd = body.indexOf('\r\n', cursor);
      if (lineEnd < 0) return null;
      const size = parseInt(body.slice(cursor, lineEnd), 16);
      if (Number.isNaN(size)) return null;
      if (size === 0) break;
      chunks.push(body.slice(lineEnd + 2, lineEnd + 2 + size));
      cursor = lineEnd + 2 + size + 2;
    }
    body = chunks.join('');
  }
  try {
    const { current } = JSON.parse(Buffer.from(body, 'latin1').toString('utf8'));
    return typeof current === 'string' && current ? current : null;
  } catch {
    return null;
  }
};

// One attempt. Resolves the password, or null while the pairing window is
// closed (the gateway then answers 401).
export const tryReadLocalPassword = (
  hostname: string,
  mac: string,
): Promise<string | null> =>
  new Promise((resolve) => {
    const ws = new WebSocket(
      `wss://${hostname}:443/mediation/client?mac=${mac}&appli=1`,
      { rejectUnauthorized: false, handshakeTimeout: 3000 },
    );
    let received = Buffer.alloc(0);
    let settled = false;
    const finish = (password: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.terminate();
      } catch {
        // already closed
      }
      resolve(password);
    };
    const timer = setTimeout(() => finish(null), ATTEMPT_TIMEOUT_MS);
    ws.on('unexpected-response', () => finish(null));
    ws.on('error', () => finish(null));
    ws.on('open', () =>
      ws.send(
        Buffer.from(
          `GET ${PASSWORD_URI} HTTP/1.1\r\nContent-Length: 0\r\nContent-Type: application/json; charset=UTF-8\r\nTransac-Id: 0\r\n\r\n`,
          'ascii',
        ),
      ),
    );
    ws.on('message', (data: Buffer) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      received = Buffer.concat([received, chunk]);
      const password = extractPassword(chunk) ?? extractPassword(received);
      if (password) finish(password);
    });
  });
