import { App } from 'homey';
import TydomController, { GatewayStatus } from './controller';
import { fetchGateways } from './cloud';
import { Logger } from './util';

type HomeyInstance = App['homey'];

export interface GatewaySetting {
  name?: string;
  mac: string;
  hostname: string;
  password: string;
}

export interface DiscoveredGateway {
  mac: string;
  address: string;
  configured: boolean;
}

// MAC discovery for Delta Dore's OUI 00:1A:25, see .homeycompose/discovery.
const STRATEGY_ID = 'tydom';

const normalizeMac = (mac: string) =>
  mac.replace(/[^0-9a-f]/gi, '').toUpperCase();

// Owns the `gateways` setting: keeps one TydomController per entry in sync
// with it, fills in and follows gateway addresses from MAC discovery, and
// adds gateways from pairing or the settings page. Changes apply right away.
export default class Gateways {
  constructor(
    private homey: HomeyInstance,
    private logger: Logger,
    private onChange: () => void,
  ) {}

  init() {
    this.migrate();
    this.homey.settings.on('set', (key: string) => {
      if (key === 'gateways') this.apply();
    });
    this.strategy().on('result', (result: any) => this.onDiscovered(result));
    this.apply();
  }

  list(): GatewaySetting[] {
    return (this.homey.settings.get('gateways') as GatewaySetting[]) || [];
  }

  discovered(): DiscoveredGateway[] {
    const configured = new Set(this.list().map((g) => g.mac));
    return Object.values(this.strategy().getDiscoveryResults())
      .map((result: any) => ({
        mac: normalizeMac(result.mac || result.id || ''),
        address: result.address as string,
        configured: false,
      }))
      .filter((d) => d.mac && d.address)
      .map((d) => ({ ...d, configured: configured.has(d.mac) }));
  }

  status(): { gateways: GatewayStatus[]; discovered: DiscoveredGateway[] } {
    return {
      gateways: TydomController.getInstances().map((c) => c.getStatus()),
      discovered: this.discovered(),
    };
  }

  // Add or update a gateway, keeping the user's name and a known address.
  upsert(entry: {
    mac: string;
    password: string;
    hostname?: string;
  }): TydomController {
    const mac = normalizeMac(entry.mac);
    const gateways = this.list();
    const hostname = entry.hostname || this.addressFor(mac) || '';
    const existing = gateways.find((g) => g.mac === mac);
    if (existing) {
      existing.password = entry.password;
      if (hostname) existing.hostname = hostname;
    } else {
      gateways.push({ name: '', mac, hostname, password: entry.password });
    }
    // Several gateways need names to tell their devices apart.
    if (gateways.length > 1)
      gateways.forEach((g, i) => {
        if (!g.name) g.name = `Tydom ${i + 1}`;
      });
    this.save(gateways);
    return TydomController.find(mac)!;
  }

  // Import the account's gateways. With `onlyOnThisNetwork`, gateways Homey
  // can't see (e.g. at another house) are skipped, unless none are visible.
  async addFromCloud(
    email: string,
    password: string,
    onlyOnThisNetwork = false,
  ): Promise<TydomController[]> {
    const found = await fetchGateways(email, password);
    const known = new Set([
      ...this.discovered().map((d) => d.mac),
      ...this.list()
        .filter((g) => g.hostname)
        .map((g) => g.mac),
    ]);
    const visible = found.filter((gw) => known.has(gw.mac));
    const toAdd = onlyOnThisNetwork && visible.length ? visible : found;
    return toAdd.map((gw) => this.upsert(gw));
  }

  // Settings → controllers; gateways without an address get one from
  // discovery.
  private apply() {
    const gateways = this.list();
    const missing = gateways.filter((g) => !g.hostname);
    missing.forEach((g) => {
      g.hostname = this.addressFor(g.mac) || '';
    });
    if (missing.some((g) => g.hostname)) {
      this.save(gateways);
      return; // save() applies again
    }

    const macs = new Set(gateways.map((g) => g.mac));
    TydomController.getInstances()
      .filter((c) => !macs.has(c.config.username))
      .forEach((c) => TydomController.remove(c.config.username));
    gateways.forEach((g) =>
      TydomController.upsert(this.logger, {
        settings: {},
        username: g.mac,
        password: g.password,
        hostname: g.hostname,
        gatewayName: g.name,
      }),
    );
    this.onChange();
  }

  private save(gateways: GatewaySetting[]) {
    this.homey.settings.set('gateways', gateways);
    this.apply();
  }

  private onDiscovered(result: any) {
    const mac = normalizeMac(result.mac || result.id || '');
    const gateways = this.list();
    const gateway = gateways.find((g) => g.mac === mac);
    if (!gateway || !result.address || gateway.hostname === result.address)
      return;
    this.logger.info(`Tydom ${mac} found at ${result.address}`);
    gateway.hostname = result.address;
    this.save(gateways);
  }

  private addressFor(mac: string): string | undefined {
    return this.discovered().find((d) => d.mac === mac)?.address;
  }

  private strategy() {
    return this.homey.discovery.getStrategy(STRATEGY_ID);
  }

  // Installs before multi-gateway support stored one gateway in flat
  // hostname/username/password keys; move it into the gateways list once.
  private migrate() {
    if (this.homey.settings.get('gateways')) return;
    const password = this.homey.settings.get('password') as string;
    if (!password) return;
    this.homey.settings.set('gateways', [
      {
        name: '',
        mac: (this.homey.settings.get('username') as string) || '',
        hostname: (this.homey.settings.get('hostname') as string) || '',
        password,
      },
    ]);
    ['hostname', 'username', 'password'].forEach((key) =>
      this.homey.settings.unset(key),
    );
    this.logger.info('Migrated single-gateway settings to the gateways list');
  }
}
