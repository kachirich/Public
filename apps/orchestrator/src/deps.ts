import type { PaymentsPort, RegistryPort, RoomsPort, SchedulingPort } from '@marketplace/core';
import type { Pool } from 'pg';
import type { PricingConfig } from './services/pricing.js';

// Everything the routes, services, and timer handlers depend on. Tests
// build this with fakes; production wiring lives in index.ts.
export interface AppDeps {
  pool: Pool;
  scheduling: SchedulingPort;
  payments: PaymentsPort;
  rooms: RoomsPort;
  registry: RegistryPort;
  pricing: PricingConfig;
  sharedSecret: string;
  /** Secret path segment for the (unsigned) Daraja callback; absent = mpesa webhook disabled. */
  mpesaCallbackToken?: string;
  /** Injectable clock so e2e tests can drive timers deterministically. */
  now: () => Date;
}
