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

class TydomApp extends App {
  private controller?: TydomController;
  private debug = false;

  async onInit() {
    this.log('Delta Dore Tydom 1.0 has been initialized');

    // Non-secret defaults — override via Configure App in Homey settings.
    const DEFAULT_HOSTNAME = '192.168.1.11';
    const DEFAULT_USERNAME = '001A2506DEB2';

    const hostname =
      (this.homey.settings.get('hostname') as string) || DEFAULT_HOSTNAME;
    const username =
      (this.homey.settings.get('username') as string) || DEFAULT_USERNAME;
    const password = (this.homey.settings.get('password') as string) || '';

    if (!password) {
      this.log(
        'Tydom password missing — open the app Configure page in Homey, enter the gateway password, then restart the app.',
      );
      this.homey.settings.on('set', (key: string) => {
        if (['hostname', 'username', 'password'].includes(key)) {
          this.log(`Setting "${key}" changed — restart the app to apply.`);
        }
      });
      return;
    }

    this.log(`Tydom using hostname=${hostname} username=${username}`);

    const logger = new DefaultLogger(this.log, this.error, this.debug);

    this.controller = TydomController.createInstance(logger, {
      settings: {},
      debug: this.debug,
      username,
      password,
      hostname,
    });

    assert(this.controller);
    try {
      await this.controller.connect();
      await this.controller.scan();
      this.log('Tydom connected and scanned');
    } catch (err) {
      this.error('Tydom connect/scan failed:', err);
    }

    this.homey.settings.on('set', (key: string) => {
      if (['hostname', 'username', 'password'].includes(key)) {
        this.log(`Setting "${key}" changed — restart the app to apply.`);
      }
    });
  }

  async onUninit() {
    this.log('Stopping app');
    if (this.controller) this.controller.disconnect();
    return Promise.resolve();
  }
}

module.exports = TydomApp;
