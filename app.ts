import tls from 'tls';
import { constants } from 'crypto';
import { App } from 'homey';
import TydomController from './tydom/controller';
import Gateways from './tydom/gateways';
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
  private debug = false;
  gateways!: Gateways;

  async onInit() {
    this.log('Delta Dore Tydom has been initialized');

    const logger = new DefaultLogger(this.log, this.error, this.debug);
    // Gateways connect in the background; devices follow their gateway's
    // state, so nothing here waits for a connection.
    this.gateways = new Gateways(this.homey, logger, () => this.attachDevices());
    this.gateways.init();
  }

  // Re-link devices after the gateway list changed (added, removed, re-added).
  private attachDevices() {
    Object.values(this.homey.drivers.getDrivers()).forEach((driver) => {
      try {
        driver.getDevices().forEach((device) => {
          (device as unknown as { link?: { attach(): void } }).link?.attach();
        });
      } catch {
        // driver not initialized yet; its devices attach in their onInit
      }
    });
  }

  async onUninit() {
    this.log('Stopping app');
    TydomController.getInstances().forEach((c) => c.stop());
    return Promise.resolve();
  }
}

module.exports = TydomApp;
