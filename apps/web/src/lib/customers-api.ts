/**
 * Customers API Service
 *
 * Typed wrappers over /api/v1/customers endpoints.
 * COMPLIANCE: No PHI in query strings. Encrypted fields decrypted server-side only.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type CustomerStatus = 'active' | 'inactive' | 'churned';
export type CustomerType = 'individual' | 'company';
export type LifecycleStage =
  | 'lead'
  | 'qualified'
  | 'opportunity'
  | 'customer'
  | 'churning'
  | 'churned';

export interface Customer {
  readonly id: string;
  readonly tenantId: string;
  readonly externalId: string | null;
  readonly type: CustomerType;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly status: CustomerStatus;
  readonly lifecycleStage: LifecycleStage;
  readonly healthScore: number | null;
  readonly assignedUserId: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CustomerListParams {
  page?: number;
  pageSize?: number;
  status?: CustomerStatus;
  type?: CustomerType;
  lifecycleStage?: LifecycleStage;
  search?: string;
}

export interface CustomerListResponse {
  readonly success: true;
  readonly data: Customer[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface CreateCustomerBody {
  readonly externalId?: string;
  readonly type: CustomerType;
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
  readonly metadata?: Record<string, unknown>;
  readonly lifecycleStage?: LifecycleStage;
  readonly assignedUserId?: string;
}

export interface UpdateCustomerBody {
  readonly name?: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly status?: CustomerStatus;
  readonly lifecycleStage?: LifecycleStage;
  readonly healthScore?: number;
  readonly assignedUserId?: string | null;
}

// ── API Functions ──────────────────────────────────────────────────

export function listCustomers(params: CustomerListParams = {}): Promise<CustomerListResponse> {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  if (params.status !== undefined) query.set('status', params.status);
  if (params.type !== undefined) query.set('type', params.type);
  if (params.lifecycleStage !== undefined) query.set('lifecycleStage', params.lifecycleStage);
  if (params.search !== undefined && params.search.length > 0) query.set('search', params.search);
  const qs = query.toString();
  return apiClient.get<CustomerListResponse>(`/v1/customers${qs.length > 0 ? `?${qs}` : ''}`);
}

export function getCustomer(
  id: string,
): Promise<{ readonly success: true; readonly data: Customer }> {
  return apiClient.get<{ readonly success: true; readonly data: Customer }>(`/v1/customers/${id}`);
}

export function createCustomer(
  body: CreateCustomerBody,
): Promise<{ readonly success: true; readonly data: Customer }> {
  return apiClient.post<{ readonly success: true; readonly data: Customer }>('/v1/customers', body);
}

export function updateCustomer(
  id: string,
  body: UpdateCustomerBody,
): Promise<{ readonly success: true; readonly data: Customer }> {
  return apiClient.patch<{ readonly success: true; readonly data: Customer }>(
    `/v1/customers/${id}`,
    body,
  );
}

export async function deleteCustomer(id: string): Promise<void> {
  await apiClient.delete(`/v1/customers/${id}`);
}
