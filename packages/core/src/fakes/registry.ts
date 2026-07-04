import type { Registry, RegistryLookupResult, RegistryPort } from '../ports/registry.js';

// In-memory RegistryPort: configure known registrations, or make the next
// lookups blow up to exercise the scraper-failure -> manual-review path.
export class FakeRegistryPort implements RegistryPort {
  readonly entries = new Map<string, string>(); // "REGISTRY:number" -> registered name
  failNextLookups = 0;
  readonly lookups: { registry: Registry; registrationNumber: string }[] = [];

  register(registry: Registry, registrationNumber: string, name: string): void {
    this.entries.set(`${registry}:${registrationNumber}`, name);
  }

  async lookup(registry: Registry, registrationNumber: string): Promise<RegistryLookupResult> {
    this.lookups.push({ registry, registrationNumber });
    if (this.failNextLookups > 0) {
      this.failNextLookups -= 1;
      throw new Error('FakeRegistryPort: simulated scraper failure');
    }
    const name = this.entries.get(`${registry}:${registrationNumber}`);
    if (name === undefined) return { found: false, registryName: null, raw: { source: 'fake' } };
    return { found: true, registryName: name, raw: { source: 'fake', name } };
  }
}
