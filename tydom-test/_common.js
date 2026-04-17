/* eslint-disable no-console */
/**
 * Shared helpers for tydom-test scripts:
 *  - TLS legacy-renegotiation patch (required for Tydom 1.0)
 *  - Credential loading: hostname and MAC default to the author's gateway
 *    values. The password is NEVER hardcoded — provide it via env var
 *    TYDOM_PASS or via tydom-test/.env.json (gitignored).
 *
 * Never commit a real password to a test script.
 */

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const tls = require('tls');
const { constants } = require('crypto');
const fs = require('fs');
const path = require('path');

const _orig = tls.createSecureContext;
tls.createSecureContext = (o = {}) =>
  _orig({
    ...o,
    secureOptions:
      (o.secureOptions || 0) | constants.SSL_OP_LEGACY_SERVER_CONNECT,
  });

const DEFAULT_HOST = '192.168.1.11';
const DEFAULT_USER = '001A2506DEB2';

function loadCreds() {
  const envFile = path.join(__dirname, '.env.json');
  let fileCreds = {};
  if (fs.existsSync(envFile)) {
    try {
      fileCreds = JSON.parse(fs.readFileSync(envFile, 'utf8'));
    } catch (e) {
      console.error(`Failed to parse ${envFile}:`, e.message);
    }
  }
  const hostname = process.env.TYDOM_HOST || fileCreds.hostname || DEFAULT_HOST;
  const username = process.env.TYDOM_USER || fileCreds.username || DEFAULT_USER;
  const password = process.env.TYDOM_PASS || fileCreds.password;
  if (!password) {
    console.error(
      'Missing Tydom password. Set TYDOM_PASS env var, or create tydom-test/.env.json with { "password": "..." }.',
    );
    process.exit(1);
  }
  return { hostname, username, password };
}

module.exports = { loadCreds };
