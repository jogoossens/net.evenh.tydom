import https from 'https';

// Delta Dore cloud (Azure AD B2C, ROPC flow) — same endpoints the Tydom mobile
// app and the Home Assistant integration use. Only needed once, to read the
// gateway's local digest password; all device control stays on the LAN.
const OIDC_CONFIG_URL =
  'https://deltadoreadb2ciot.b2clogin.com/deltadoreadb2ciot.onmicrosoft.com/v2.0/.well-known/openid-configuration?p=B2C_1_AccountProviderROPC_SignIn';
const CLIENT_ID = '8782839f-3264-472a-ab87-4d4e23524da4';
const SCOPE =
  'openid profile offline_access https://deltadoreadb2ciot.onmicrosoft.com/iotapi/sites_management_gateway_credentials';
const SITES_API = 'https://prod.iotdeltadore.com/sitesmanagement/api';

export interface GatewayCredentials {
  mac: string;
  password: string;
}

// app.ts sets NODE_TLS_REJECT_UNAUTHORIZED=0 for the gateway's self-signed
// cert; force verification back on since we send account credentials here.
const request = (
  url: string,
  options: https.RequestOptions = {},
  body?: string,
): Promise<{ status: number; json: any }> =>
  new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { ...options, rejectUnauthorized: true, timeout: 15000 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let json: any;
          try {
            json = JSON.parse(data);
          } catch {
            json = {};
          }
          resolve({ status: res.statusCode || 0, json });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('Delta Dore cloud timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });

const normalizeMac = (mac: string) =>
  mac.replace(/[^0-9a-f]/gi, '').toUpperCase();

export async function fetchGateways(
  email: string,
  password: string,
): Promise<GatewayCredentials[]> {
  const oidc = await request(OIDC_CONFIG_URL);
  const tokenEndpoint = oidc.json.token_endpoint;
  if (!tokenEndpoint) throw new Error('Delta Dore login service unavailable');

  const form = new URLSearchParams({
    username: email,
    password,
    grant_type: 'password',
    client_id: CLIENT_ID,
    scope: SCOPE,
  }).toString();
  const token = await request(
    tokenEndpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(form),
      },
    },
    form,
  );
  if (!token.json.access_token) {
    throw new Error('Delta Dore login failed — check email and password');
  }

  // v2 lists the account's site ids; v1 per site returns its gateway MAC +
  // password. Lets users skip entering the MAC entirely.
  const auth = {
    headers: { Authorization: `Bearer ${token.json.access_token}` },
  };
  const list = await request(`${SITES_API}/v2/sites`, auth);
  const sites = await Promise.all(
    ((list.json.elements || []) as any[]).map((el) =>
      request(`${SITES_API}/v1/sites/${el.id}`, auth),
    ),
  );
  const gateways = sites
    .map((site) => site.json.gateway)
    .filter((gw) => gw && gw.mac && gw.password);

  if (!gateways.length) {
    throw new Error('No Tydom gateway found on this Delta Dore account');
  }
  return gateways.map((gw) => ({
    mac: normalizeMac(gw.mac),
    password: gw.password,
  }));
}
