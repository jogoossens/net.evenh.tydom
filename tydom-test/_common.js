/* eslint-disable no-console */
/**
 * Shared helpers for tydom-test scripts:
 *  - TLS legacy-renegotiation patch (required for Tydom 1.0)
 *  - Credential loading from env vars TYDOM_HOST / TYDOM_USER / TYDOM_PASS
 *    or tydom-test/.env.json (gitignored). Nothing is hardcoded.
 *  - Device selection from env vars DEVICE / ENDPOINT (see test-connect.js
 *    output for ids).
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
  const hostname = process.env.TYDOM_HOST || fileCreds.hostname;
  const username = process.env.TYDOM_USER || fileCreds.username;
  const password = process.env.TYDOM_PASS || fileCreds.password;
  if (!hostname || !username || !password) {
    console.error(
      'Missing Tydom credentials. Set TYDOM_HOST / TYDOM_USER / TYDOM_PASS env vars, or copy tydom-test/.env.example to tydom-test/.env.json and fill it in.',
    );
    process.exit(1);
  }
  return { hostname, username, password };
}

// Endpoint id defaults to the device id (true for Tybox thermostats).
function loadDevice() {
  const device = Number(process.env.DEVICE);
  const endpoint = Number(process.env.ENDPOINT || process.env.DEVICE);
  if (!device) {
    console.error(
      'Missing DEVICE env var — run test-connect.js to list device ids, then e.g. DEVICE=1234567890 node tydom-test/<script>.js',
    );
    process.exit(1);
  }
  return { device, endpoint };
}

module.exports = { loadCreds, loadDevice };
