/**
 * Customer data factories — synthetic test data only.
 *
 * SECURITY: No real PHI is ever generated.
 * All phone numbers use +1555 range (NANPA reserved for fiction).
 * All emails use @example.com (RFC 2606 reserved).
 */

import { randomUUID } from 'node:crypto';

export interface MockCustomer {
  readonly id: string;
  readonly tenantId: string;
  readonly externalId: string;
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly segment: string;
  readonly lifecycleStage: string;
  readonly healthScore: number;
  readonly ltv: number;
  readonly createdAt: Date;
}

export interface MockContact {
  readonly id: string;
  readonly customerId: string;
  readonly channel: string;
  readonly value: string;
  readonly isPrimary: boolean;
  readonly consentStatus: string;
}

const SEGMENTS = ['enterprise', 'mid_market', 'smb', 'startup'] as const;
const STAGES = ['prospect', 'onboarding', 'active', 'at_risk', 'churned'] as const;

let counter = 0;

export function createMockCustomer(
  overrides?: Partial<MockCustomer>,
): MockCustomer {
  counter += 1;
  const idx = String(counter).padStart(4, '0');

  return {
    id: overrides?.id ?? `cust_${randomUUID().slice(0, 8)}`,
    tenantId: overrides?.tenantId ?? 'tnt_test',
    externalId: overrides?.externalId ?? `EXT-${idx}`,
    name: overrides?.name ?? `Test Customer ${idx}`,
    email: overrides?.email ?? `customer-${idx}@example.com`,
    phone: overrides?.phone ?? `+1555${idx.padStart(7, '0').slice(-7)}`,
    segment: overrides?.segment ?? SEGMENTS[counter % SEGMENTS.length]!,
    lifecycleStage: overrides?.lifecycleStage ?? STAGES[counter % STAGES.length]!,
    healthScore: overrides?.healthScore ?? 50 + (counter % 50),
    ltv: overrides?.ltv ?? 1000 + counter * 500,
    createdAt: overrides?.createdAt ?? new Date('2026-01-15T10:00:00.000Z'),
  };
}

export function createMockContact(
  customerId: string,
  overrides?: Partial<MockContact>,
): MockContact {
  counter += 1;
  const idx = String(counter).padStart(4, '0');

  return {
    id: overrides?.id ?? `con_${randomUUID().slice(0, 8)}`,
    customerId,
    channel: overrides?.channel ?? 'sms',
    value: overrides?.value ?? `+1555${idx.padStart(7, '0').slice(-7)}`,
    isPrimary: overrides?.isPrimary ?? true,
    consentStatus: overrides?.consentStatus ?? 'opted_in',
  };
}
