export type Registry = 'KMPDC' | 'LSK' | 'ICPAK' | 'EBK' | 'UNIVERSITY' | 'OTHER';

export interface RegistryLookupResult {
  found: boolean;
  registryName: string | null;
  raw: unknown;
}

// One adapter per registry sits behind this port — core code never scrapes.
export interface RegistryPort {
  lookup(registry: Registry, registrationNumber: string): Promise<RegistryLookupResult>;
}
