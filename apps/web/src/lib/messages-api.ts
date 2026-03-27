/**
 * Messages API Service
 *
 * Typed wrappers over /api/v1/messages endpoints.
 * NOTE: Message content is NEVER returned by the API (HIPAA §164.312).
 * Only metadata is exposed.
 */

import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type MessageChannel = 'sms' | 'email' | 'voice' | 'whatsapp';
export type MessageStatus =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'bounced'
  | 'opted_out'
  | 'retrying'
  | 'dlq';
export type MessageDirection = 'inbound' | 'outbound';

export interface MessageMetadata {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly channel: MessageChannel;
  readonly direction: MessageDirection;
  readonly status: MessageStatus;
  readonly sentAt: string | null;
  readonly deliveredAt: string | null;
  readonly failedAt: string | null;
  readonly providerMessageId: string | null;
  readonly correlationId: string;
  readonly createdAt: string;
}

export interface MessageListParams {
  page?: number;
  pageSize?: number;
  customerId?: string;
  channel?: MessageChannel;
  status?: MessageStatus;
  direction?: MessageDirection;
}

export interface MessageListResponse {
  readonly success: true;
  readonly data: MessageMetadata[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

// ── API Functions ──────────────────────────────────────────────────

export function listMessages(params: MessageListParams = {}): Promise<MessageListResponse> {
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined) query.set('pageSize', String(params.pageSize));
  if (params.customerId !== undefined) query.set('customerId', params.customerId);
  if (params.channel !== undefined) query.set('channel', params.channel);
  if (params.status !== undefined) query.set('status', params.status);
  if (params.direction !== undefined) query.set('direction', params.direction);
  const qs = query.toString();
  return apiClient.get<MessageListResponse>(`/v1/messages${qs.length > 0 ? `?${qs}` : ''}`);
}

export function getMessage(
  id: string,
): Promise<{ readonly success: true; readonly data: MessageMetadata }> {
  return apiClient.get<{ readonly success: true; readonly data: MessageMetadata }>(
    `/v1/messages/${id}`,
  );
}

export function sendMessage(body: {
  readonly customerId: string;
  readonly channel: 'sms' | 'email';
  readonly contentRef: string;
}): Promise<{ readonly success: true; readonly messageId: string }> {
  return apiClient.post<{ readonly success: true; readonly messageId: string }>(
    '/v1/messages/send',
    body,
  );
}
