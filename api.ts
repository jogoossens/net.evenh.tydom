import { fetchGateways } from './tydom/cloud';
import TydomController from './tydom/controller';

const UNREACHABLE = [
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
];

const describeConnectionError = (err: any, hostname: string) => {
  const message = err instanceof Error ? err.message : String(err);
  if (/\b401\b/.test(message)) return 'Wrong gateway password';
  if (UNREACHABLE.includes(err?.code))
    return `Can't reach ${hostname} — check the IP address`;
  if (/No answer/.test(message))
    // Tydom 1.0 answers a wrong password with a 401 or with silence, and
    // stays silent for a while after one; it also serves one client at a time.
    return `The gateway at ${hostname} didn't answer. Check the gateway password, close the Tydom app on this network, and try again in a minute`;
  return message;
};

module.exports = {
  // Called from the settings page. The Delta Dore account password is used
  // for this one request and never stored. Returns every gateway on the
  // account so the page can import the ones the user picks.
  async cloudLogin({ body }: { body: any }) {
    const { email, password } = body || {};
    if (!email || !password) throw new Error('Email and password are required');

    return { gateways: await fetchGateways(email, password) };
  },

  async testConnection({ body }: { body: any }) {
    const { mac, hostname, password } = body || {};
    if (!mac || !hostname || !password)
      throw new Error('MAC, hostname and password are required');

    try {
      await TydomController.testConnection(hostname, mac, password);
    } catch (err) {
      throw new Error(describeConnectionError(err, hostname));
    }
    return { ok: true };
  },
};
