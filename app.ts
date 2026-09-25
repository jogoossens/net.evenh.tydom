import assert from 'assert';
import tls from 'tls';
import { constants } from 'crypto';
import { App } from 'homey';
import TydomController from './tydom/controller';
import { DefaultLogger } from './tydom/util';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Tydom 1.0 speaks pre-RFC5746 TLS; modern Node rejects its renegotiation with
// "unsafe legacy renegotiation disabled". Opt in to the legacy flag globally.
const _origCreateSecureContext = tls.createSecureContext;
tls.createSecureContext = (options: tls.SecureContextOptions = {}) =>
  _origCreateSecureContext({
    ...options,
    secureOptions:
      (options.secureOptions || 0) | constants.SSL_OP_LEGACY_SERVER_CONNECT,
  });

interface GatewaySetting {
  name?: string;
  mac: string;
  hostname: string;
  password: string;
}

class TydomApp extends App {
  private debug = false;

  async onInit() {
    this.log('Delta Dore Tydom 1.0 has been initialized');

    this.homey.settings.on('set', (key: string) => {
      if (key === 'gateways') {
        this.log(`Setting "${key}" changed — restart the app to apply.`);
      }
    });

    const gateways = this.getGateways();
    if (!gateways.length) {
      this.log(
        'No Tydom gateway configured — open the app Configure page in Homey, add a gateway, then restart the app.',
      );
      return;
    }

    const logger = new DefaultLogger(this.log, this.error, this.debug);

    // Connect in parallel so one unreachable gateway doesn't block the others.
    await Promise.all(
      gateways.map(async ({ name, mac, hostname, password }) => {
        this.log(`Tydom using hostname=${hostname} username=${mac}`);
        const controller = TydomController.createInstance(logger, {
          settings: {},
          debug: this.debug,
          username: mac,
          password,
          hostname,
          gatewayName: name,
        });
        assert(controller);
        try {
          await controller.connect();
          await controller.scan();
          this.log(`Tydom ${mac} connected and scanned`);
        } catch (err) {
          this.error(`Tydom ${mac} connect/scan failed:`, err);
        }
      }),
    );
  }

  // Installs before multi-gateway support stored one gateway in flat
  // hostname/username/password keys; move it into the gateways list once.
  private getGateways(): GatewaySetting[] {
    const gateways = this.homey.settings.get('gateways') as
      | GatewaySetting[]
      | null;
    if (gateways) return gateways;

    const password = this.homey.settings.get('password') as string;
    if (!password) return [];

    const migrated = [
      {
        mac: (this.homey.settings.get('username') as string) || '',
        hostname: (this.homey.settings.get('hostname') as string) || '',
        password,
      },
    ];
    this.homey.settings.set('gateways', migrated);
    ['hostname', 'username', 'password'].forEach((key) =>
      this.homey.settings.unset(key),
    );
    this.log('Migrated single-gateway settings to the gateways list');
    return migrated;
  }

  async onUninit() {
    this.log('Stopping app');
    TydomController.getInstances().forEach((c) => c.disconnect());
    return Promise.resolve();
  }
}

module.exports = TydomApp;
