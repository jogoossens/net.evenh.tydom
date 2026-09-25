import type Gateways from './tydom/gateways';

const gatewaysOf = (homey: any) => (homey.app as { gateways: Gateways }).gateways;

module.exports = {
  // Called from the settings page. The Delta Dore account password is used
  // for this one request and never stored; the account's gateways are added
  // to the gateway list and connect right away.
  async cloudLogin({ homey, body }: { homey: any; body: any }) {
    const { email, password } = body || {};
    if (!email || !password) throw new Error('Email and password are required');

    const controllers = await gatewaysOf(homey).addFromCloud(email, password);
    return { gateways: controllers.map((c) => c.config.username) };
  },

  // Live connection state per gateway plus gateways found on the network.
  async status({ homey }: { homey: any }) {
    return gatewaysOf(homey).status();
  },
};
