# ORDR-Connect Phase 7 Implementation Plan

**Document:** IMPLEMENTATION-PLAN-PHASE7.md  
**Version:** 1.0.0  
**Date:** 2026-03-27  
**Status:** APPROVED FOR IMPLEMENTATION  
**Classification:** Internal — Engineering  

---

## Executive Summary

Phase 7 closes the gap between ORDR-Connect's fully implemented backend (118 endpoints across 19 route files) and a frontend that still renders hardcoded mock data. It also wires the `packages/ai` LLM stack to the live Anthropic API and ships three ML features (sentiment analysis, embeddings, entity routing) as first-class backend services consumed by the UI.

The work is structured into five sequential sub-phases:

| Sub-phase | Name | Duration estimate | Risk |
|-----------|------|------------------|------|
| 7A | Foundation: API service layer + LLM wiring | 1 week | Low |
| 7B | Core pages: Dashboard, Customers, Agents, Interactions | 1.5 weeks | Medium |
| 7C | Intelligence pages: Analytics, Compliance, Healthcare | 1 week | Medium |
| 7D | Platform pages: Marketplace, Developer, Partner, Settings | 1 week | Low |
| 7E | Real-time, ML features, end-to-end testing | 1.5 weeks | High |

**Total estimated effort:** 6 weeks (1 engineer full-time) or 3 weeks (2 engineers).

---

## Dependency Order (Must-Respect)

```
7A (service layer) → 7B (core pages) → 7C (intelligence) → 7D (platform) → 7E (real-time + ML)
```

Phase 7A has no external dependencies and must land first because every subsequent phase imports from the new service modules. Phases 7B-7D can be partially parallelized by two engineers after 7A is merged.

---

## Architecture Constraints (Non-Negotiable)

1. All frontend HTTP calls route through `apps/web/src/lib/api.ts` `apiClient` — no raw `fetch()` calls in page components.
2. Every API response type must be explicitly typed (`no any` violations will fail CI lint).
3. Token is in-memory only (`setAccessToken` / `getAccessToken`) — NEVER `localStorage` (HIPAA §164.312).
4. Real-time events consumed via SSE endpoint `/v1/events/stream`, dispatched through the `@ordr/realtime` `EventPublisher`.
5. All LLM calls use the existing `LLMClient` in `packages/ai/src/client.ts`. The `anthropicApiKey` is injected from environment (`ANTHROPIC_API_KEY`) at startup — NEVER hardcoded.
6. Compliance gate (`ComplianceGate.check()`) must be invoked server-side before every customer-facing mutation. Frontend does not call the gate directly.

---

## Phase 7A — Foundation: API Service Layer + LLM Wiring

### Goal
Build the typed service module layer in `apps/web/src/lib/` and wire the `LLMClient` to the live Anthropic API key. No page component touches `apiClient` directly after this phase — every call goes through a domain service module.

### 7A.1 — LLM Wiring (Backend)

**File to modify:** `apps/api/src/index.ts` (or the startup entry point that instantiates dependencies)

The `LLMClient` constructor already accepts `{ anthropicApiKey: string }`. The only task is ensuring the startup wires it from `process.env.ANTHROPIC_API_KEY` rather than leaving it uninstantiated.

**Change:**
```typescript
// apps/api/src/index.ts (startup wiring — modify existing block)

import { LLMClient } from '@ordr/ai';

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error('[ORDR:API] ANTHROPIC_API_KEY is required');
}

const llmClient = new LLMClient({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  defaultTier: 'standard',   // claude-sonnet-4-5 for most agent work
  defaultMaxTokens: 4096,
  defaultTemperature: 0.1,
  timeoutMs: 30_000,
  maxRetries: 3,
});
```

**Model assignment per feature** (update `packages/ai/src/models.ts` `MODEL_REGISTRY` entries to use the target model names):

| Feature | Model Tier | Anthropic Model | Justification |
|---------|-----------|-----------------|---------------|
| Agent reasoning (lead_qualifier, churn_detection) | `premium` | `claude-opus-4-6` | High-stakes decisions requiring deep reasoning |
| Agent execution (follow_up, support_triage) | `standard` | `claude-sonnet-4-6` | Balanced cost/capability for routine tasks |
| Sentiment analysis (batch) | `budget` | `claude-haiku-4-5-20251001` | High-volume, low-complexity scoring |
| Embeddings (semantic search) | N/A | Voyage-3 via Anthropic | Dedicated embedding model |
| Entity routing decisions | `standard` | `claude-sonnet-4-6` | Routing needs context comprehension |
| Executive briefing agent | `premium` | `claude-opus-4-6` | Synthesis of complex customer data |
| Healthcare workflow | `premium` | `claude-opus-4-6` | HIPAA-sensitive, accuracy-critical |

**File to modify:** `packages/ai/src/models.ts` — update `MODEL_REGISTRY.premium.modelName` to `'claude-opus-4-6'` and `MODEL_REGISTRY.standard.modelName` to `'claude-sonnet-4-6'`.

### 7A.2 — New Frontend Service Modules

All files live in `apps/web/src/lib/`. The existing `analytics-api.ts`, `settings-api.ts`, `tickets-api.ts`, `reports-api.ts`, and `help-api.ts` already exist as reference patterns. Phase 7A adds the missing domain services.

#### 7A.2.1 — `apps/web/src/lib/customers-api.ts` (NEW)

```typescript
import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type CustomerStatus = 'active' | 'inactive' | 'churned';
export type CustomerType = 'individual' | 'company';
export type LifecycleStage =
  | 'lead' | 'qualified' | 'opportunity' | 'customer' | 'churning' | 'churned';

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

// ── API functions ──────────────────────────────────────────────────

export function listCustomers(params: CustomerListParams = {}): Promise<CustomerListResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.status) query.set('status', params.status);
  if (params.type) query.set('type', params.type);
  if (params.lifecycleStage) query.set('lifecycleStage', params.lifecycleStage);
  if (params.search) query.set('search', params.search);
  const qs = query.toString();
  return apiClient.get<CustomerListResponse>(`/v1/customers${qs ? `?${qs}` : ''}`);
}

export function getCustomer(id: string): Promise<{ data: Customer }> {
  return apiClient.get<{ data: Customer }>(`/v1/customers/${id}`);
}

export function createCustomer(body: CreateCustomerBody): Promise<{ data: Customer }> {
  return apiClient.post<{ data: Customer }>('/v1/customers', body);
}

export function updateCustomer(id: string, body: UpdateCustomerBody): Promise<{ data: Customer }> {
  return apiClient.patch<{ data: Customer }>(`/v1/customers/${id}`, body);
}

export function deleteCustomer(id: string): Promise<void> {
  return apiClient.delete<void>(`/v1/customers/${id}`);
}
```

#### 7A.2.2 — `apps/web/src/lib/agents-api.ts` (NEW)

```typescript
import { apiClient } from './api';

// ── Types ──────────────────────────────────────────────────────────

export type AgentRole =
  | 'lead_qualifier' | 'follow_up' | 'meeting_prep' | 'churn_detection'
  | 'collections' | 'support_triage' | 'escalation' | 'executive_briefing';

export type AutonomyLevel =
  | 'rule_based' | 'router' | 'supervised' | 'autonomous' | 'full_autonomy';

export type SessionStatus = 'active' | 'completed' | 'killed' | 'escalated' | 'failed';

export interface AgentSession {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly agentRole: AgentRole;
  readonly status: SessionStatus;
  readonly autonomyLevel: AutonomyLevel;
  readonly steps: AgentStep[];
  readonly costCents: number;
  readonly confidenceScore: number | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly killReason: string | null;
}

export interface AgentStep {
  readonly stepNumber: number;
  readonly action: string;
  readonly toolUsed: string | null;
  readonly confidence: number;
  readonly approved: boolean;
  readonly timestamp: string;
}

export interface HitlItem {
  readonly id: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly action: string;
  readonly reason: string;
  readonly context: Record<string, unknown>;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface TriggerAgentBody {
  readonly customerId: string;
  readonly agentRole: AgentRole;
  readonly autonomyLevel?: AutonomyLevel;
}

export interface KillSessionBody {
  readonly reason: string;
}

export interface ApproveHitlBody {
  readonly notes?: string;
}

export interface RejectHitlBody {
  readonly reason: string;
}

export interface SessionListParams {
  page?: number;
  pageSize?: number;
  status?: SessionStatus;
  agentRole?: AgentRole;
}

export interface SessionListResponse {
  readonly data: AgentSession[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface HitlListResponse {
  readonly data: HitlItem[];
  readonly total: number;
}

// ── API functions ──────────────────────────────────────────────────

export function triggerAgent(body: TriggerAgentBody): Promise<{ sessionId: string }> {
  return apiClient.post<{ sessionId: string }>('/v1/agents/trigger', body);
}

export function listSessions(params: SessionListParams = {}): Promise<SessionListResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.status) query.set('status', params.status);
  if (params.agentRole) query.set('agentRole', params.agentRole);
  const qs = query.toString();
  return apiClient.get<SessionListResponse>(`/v1/agents/sessions${qs ? `?${qs}` : ''}`);
}

export function getSession(sessionId: string): Promise<{ data: AgentSession }> {
  return apiClient.get<{ data: AgentSession }>(`/v1/agents/sessions/${sessionId}`);
}

export function killSession(sessionId: string, body: KillSessionBody): Promise<void> {
  return apiClient.post<void>(`/v1/agents/sessions/${sessionId}/kill`, body);
}

export function listHitl(): Promise<HitlListResponse> {
  return apiClient.get<HitlListResponse>('/v1/agents/hitl');
}

export function approveHitl(hitlId: string, body: ApproveHitlBody): Promise<void> {
  return apiClient.post<void>(`/v1/agents/hitl/${hitlId}/approve`, body);
}

export function rejectHitl(hitlId: string, body: RejectHitlBody): Promise<void> {
  return apiClient.post<void>(`/v1/agents/hitl/${hitlId}/reject`, body);
}
```

#### 7A.2.3 — `apps/web/src/lib/messages-api.ts` (NEW)

```typescript
import { apiClient } from './api';

export type MessageChannel = 'sms' | 'email' | 'voice' | 'whatsapp';
export type MessageStatus =
  | 'pending' | 'queued' | 'sent' | 'delivered' | 'failed'
  | 'bounced' | 'opted_out' | 'retrying' | 'dlq';
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
  readonly data: MessageMetadata[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface SendMessageBody {
  readonly customerId: string;
  readonly channel: 'sms' | 'email';
  readonly contentRef: string;
}

export function listMessages(params: MessageListParams = {}): Promise<MessageListResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.customerId) query.set('customerId', params.customerId);
  if (params.channel) query.set('channel', params.channel);
  if (params.status) query.set('status', params.status);
  if (params.direction) query.set('direction', params.direction);
  const qs = query.toString();
  return apiClient.get<MessageListResponse>(`/v1/messages${qs ? `?${qs}` : ''}`);
}

export function getMessage(id: string): Promise<{ data: MessageMetadata }> {
  return apiClient.get<{ data: MessageMetadata }>(`/v1/messages/${id}`);
}

export function sendMessage(body: SendMessageBody): Promise<{ messageId: string }> {
  return apiClient.post<{ messageId: string }>('/v1/messages/send', body);
}
```

#### 7A.2.4 — `apps/web/src/lib/compliance-api.ts` (NEW)

```typescript
import { apiClient } from './api';

export type Regulation = 'HIPAA' | 'FDCPA' | 'TCPA' | 'GDPR' | 'PIPEDA' | 'LGPD' | 'SOC2';

export interface ComplianceViolation {
  readonly id: string;
  readonly tenantId: string;
  readonly rule: string;
  readonly regulation: Regulation;
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly description: string;
  readonly customerId: string;
  readonly correlationId: string;
  readonly timestamp: string;
  readonly resolved: boolean;
  readonly resolvedAt: string | null;
}

export interface ComplianceSummary {
  readonly score: number;
  readonly totalChecks: number;
  readonly passingChecks: number;
  readonly failingChecks: number;
  readonly criticalViolations: number;
  readonly lastAuditAt: string;
}

export interface ConsentStatus {
  readonly channel: string;
  readonly consented: number;
  readonly total: number;
  readonly percentage: number;
}

export interface RegulationBreakdown {
  readonly regulation: Regulation;
  readonly violations: number;
  readonly score: number;
}

export interface ViolationListParams {
  page?: number;
  pageSize?: number;
  regulation?: Regulation;
  severity?: 'critical' | 'high' | 'medium' | 'low';
  resolved?: boolean;
}

export interface ViolationListResponse {
  readonly data: ComplianceViolation[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export function getComplianceSummary(): Promise<{ data: ComplianceSummary }> {
  return apiClient.get<{ data: ComplianceSummary }>('/v1/compliance/summary');
}

export function listViolations(params: ViolationListParams = {}): Promise<ViolationListResponse> {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('pageSize', String(params.pageSize));
  if (params.regulation) query.set('regulation', params.regulation);
  if (params.severity) query.set('severity', params.severity);
  if (params.resolved !== undefined) query.set('resolved', String(params.resolved));
  const qs = query.toString();
  return apiClient.get<ViolationListResponse>(`/v1/compliance/violations${qs ? `?${qs}` : ''}`);
}

export function resolveViolation(id: string): Promise<void> {
  return apiClient.post<void>(`/v1/compliance/violations/${id}/resolve`, {});
}

export function getConsentStatus(): Promise<{ data: ConsentStatus[] }> {
  return apiClient.get<{ data: ConsentStatus[] }>('/v1/compliance/consent-status');
}

export function getRegulationBreakdown(): Promise<{ data: RegulationBreakdown[] }> {
  return apiClient.get<{ data: RegulationBreakdown[] }>('/v1/compliance/regulations');
}
```

#### 7A.2.5 — `apps/web/src/lib/marketplace-api.ts` (NEW)

```typescript
import { apiClient } from './api';

export type AgentStatus = 'draft' | 'review' | 'published' | 'suspended' | 'rejected';

export interface MarketplaceAgent {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly license: string;
  readonly status: AgentStatus;
  readonly manifest: Record<string, unknown>;
  readonly packageHash: string;
  readonly rating: number | null;
  readonly downloadCount: number;
  readonly category: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentReview {
  readonly id: string;
  readonly agentId: string;
  readonly rating: number;
  readonly comment: string | null;
  readonly reviewerName: string;
  readonly createdAt: string;
}

export interface MarketplaceListParams {
  limit?: number;
  offset?: number;
  search?: string;
  category?: string;
}

export interface MarketplaceListResponse {
  readonly data: MarketplaceAgent[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface PublishAgentBody {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author: string;
  readonly license: string;
  readonly manifest: Record<string, unknown>;
  readonly packageHash: string;
}

export interface ReviewBody {
  readonly rating: number;
  readonly comment?: string;
}

export function listMarketplaceAgents(
  params: MarketplaceListParams = {},
): Promise<MarketplaceListResponse> {
  const query = new URLSearchParams();
  if (params.limit) query.set('limit', String(params.limit));
  if (params.offset) query.set('offset', String(params.offset));
  if (params.search) query.set('search', params.search);
  if (params.category) query.set('category', params.category);
  const qs = query.toString();
  return apiClient.get<MarketplaceListResponse>(`/v1/marketplace${qs ? `?${qs}` : ''}`);
}

export function getMarketplaceAgent(id: string): Promise<{ data: MarketplaceAgent }> {
  return apiClient.get<{ data: MarketplaceAgent }>(`/v1/marketplace/${id}`);
}

export function publishAgent(body: PublishAgentBody): Promise<{ data: MarketplaceAgent }> {
  return apiClient.post<{ data: MarketplaceAgent }>('/v1/marketplace', body);
}

export function installAgent(agentId: string): Promise<{ installId: string }> {
  return apiClient.post<{ installId: string }>(`/v1/marketplace/${agentId}/install`, {});
}

export function uninstallAgent(agentId: string): Promise<void> {
  return apiClient.delete<void>(`/v1/marketplace/${agentId}/install`);
}

export function submitReview(agentId: string, body: ReviewBody): Promise<void> {
  return apiClient.post<void>(`/v1/marketplace/${agentId}/review`, body);
}

export function listReviews(agentId: string): Promise<{ data: AgentReview[] }> {
  return apiClient.get<{ data: AgentReview[] }>(`/v1/marketplace/${agentId}/reviews`);
}
```

#### 7A.2.6 — `apps/web/src/lib/developer-api.ts` (NEW)

```typescript
import { apiClient } from './api';

export interface ApiKeyItem {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly createdAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

export interface ApiKeyCreateResponse {
  readonly id: string;
  readonly rawKey: string;  // Shown ONCE — never stored client-side
  readonly prefix: string;
  readonly createdAt: string;
}

export interface SandboxTenant {
  readonly id: string;
  readonly name: string;
  readonly status: 'provisioning' | 'active' | 'stopped' | 'destroyed';
  readonly createdAt: string;
  readonly tier: string;
}

export interface DeveloperProfile {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly tier: 'free' | 'pro' | 'enterprise';
  readonly createdAt: string;
}

export interface CreateApiKeyBody {
  readonly name: string;
  readonly expiresAt?: string;
}

export function getDeveloperProfile(): Promise<{ data: DeveloperProfile }> {
  return apiClient.get<{ data: DeveloperProfile }>('/v1/developers/me');
}

export function listApiKeys(): Promise<{ data: ApiKeyItem[] }> {
  return apiClient.get<{ data: ApiKeyItem[] }>('/v1/developers/keys');
}

export function createApiKey(body: CreateApiKeyBody): Promise<ApiKeyCreateResponse> {
  return apiClient.post<ApiKeyCreateResponse>('/v1/developers/keys', body);
}

export function revokeApiKey(keyId: string): Promise<void> {
  return apiClient.delete<void>(`/v1/developers/keys/${keyId}`);
}

export function listSandboxes(): Promise<{ data: SandboxTenant[] }> {
  return apiClient.get<{ data: SandboxTenant[] }>('/v1/developers/sandbox');
}

export function createSandbox(name: string): Promise<{ data: SandboxTenant }> {
  return apiClient.post<{ data: SandboxTenant }>('/v1/developers/sandbox', { name });
}

export function destroySandbox(sandboxId: string): Promise<void> {
  return apiClient.delete<void>(`/v1/developers/sandbox/${sandboxId}`);
}
```

#### 7A.2.7 — `apps/web/src/lib/partners-api.ts` (NEW)

```typescript
import { apiClient } from './api';

export type PartnerTier = 'silver' | 'gold' | 'platinum';
export type PartnerStatus = 'pending' | 'active' | 'suspended';
export type PayoutStatus = 'pending' | 'processing' | 'paid' | 'failed';

export interface PartnerProfile {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly company: string;
  readonly tier: PartnerTier;
  readonly status: PartnerStatus;
  readonly revenueSharePct: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EarningsSummary {
  readonly totalCents: number;
  readonly pendingCents: number;
  readonly paidCents: number;
  readonly currency: string;
}

export interface PayoutRecord {
  readonly id: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: PayoutStatus;
  readonly paidAt: string | null;
  readonly createdAt: string;
}

export interface RegisterPartnerBody {
  readonly name: string;
  readonly email: string;
  readonly company: string;
  readonly tier?: PartnerTier;
}

export interface UpdatePartnerBody {
  readonly name?: string;
  readonly company?: string;
}

export function getPartnerProfile(): Promise<{ data: PartnerProfile }> {
  return apiClient.get<{ data: PartnerProfile }>('/v1/partners/me');
}

export function updatePartnerProfile(body: UpdatePartnerBody): Promise<{ data: PartnerProfile }> {
  return apiClient.put<{ data: PartnerProfile }>('/v1/partners/me', body);
}

export function getEarnings(): Promise<{ data: EarningsSummary }> {
  return apiClient.get<{ data: EarningsSummary }>('/v1/partners/earnings');
}

export function listPayouts(): Promise<{ data: PayoutRecord[] }> {
  return apiClient.get<{ data: PayoutRecord[] }>('/v1/partners/payouts');
}

export function registerPartner(body: RegisterPartnerBody): Promise<{ data: PartnerProfile }> {
  return apiClient.post<{ data: PartnerProfile }>('/v1/partners/register', body);
}
```

#### 7A.2.8 — `apps/web/src/lib/organizations-api.ts` (NEW)

```typescript
import { apiClient } from './api';

export interface Organization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly parentId: string | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OrgHierarchyNode {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly children: OrgHierarchyNode[];
}

export interface CreateOrgBody {
  readonly name: string;
  readonly slug: string;
  readonly parentId?: string | null;
  readonly metadata?: Record<string, unknown>;
}

export interface UpdateOrgBody {
  readonly name?: string;
  readonly slug?: string;
  readonly metadata?: Record<string, unknown>;
}

export function listOrganizations(): Promise<{ data: Organization[] }> {
  return apiClient.get<{ data: Organization[] }>('/v1/organizations');
}

export function getOrganization(id: string): Promise<{ data: Organization }> {
  return apiClient.get<{ data: Organization }>(`/v1/organizations/${id}`);
}

export function getOrgHierarchy(id: string): Promise<{ data: OrgHierarchyNode }> {
  return apiClient.get<{ data: OrgHierarchyNode }>(`/v1/organizations/${id}/hierarchy`);
}

export function createOrganization(body: CreateOrgBody): Promise<{ data: Organization }> {
  return apiClient.post<{ data: Organization }>('/v1/organizations', body);
}

export function updateOrganization(
  id: string,
  body: UpdateOrgBody,
): Promise<{ data: Organization }> {
  return apiClient.patch<{ data: Organization }>(`/v1/organizations/${id}`, body);
}

export function deleteOrganization(id: string): Promise<void> {
  return apiClient.delete<void>(`/v1/organizations/${id}`);
}
```

### 7A Testing

| Test | Location | What to verify |
|------|----------|----------------|
| Unit: service function param serialization | `apps/web/src/__tests__/lib/customers-api.test.ts` | QueryString params render correctly |
| Unit: service function return types | All `*-api.test.ts` files | TypeScript compiler rejects `any` shapes |
| Integration: `/v1/customers` round-trip | `tests/integration/customers.test.ts` (existing) | 200 response maps to `CustomerListResponse` |
| Integration: LLMClient live key | `packages/ai/src/__tests__/client.live.test.ts` | `ANTHROPIC_API_KEY` required; skip in CI without key |

---

## Phase 7B — Core Pages: Dashboard, Customers, Agents, Interactions

### 7B.1 — Dashboard.tsx

**File:** `apps/web/src/pages/Dashboard.tsx`

**Current state:** Makes two API calls (`/v1/dashboard/kpis`, `/v1/dashboard/agent-performance`) but those endpoints do not exist — falls back to mock data. Channel distribution, revenue trend, and system health are all mock.

**Backend endpoints to wire:**

| Data | Endpoint | Service function |
|------|----------|-----------------|
| KPI totals | `GET /v1/analytics/dashboard` | `fetchDashboardSummary()` in `analytics-api.ts` |
| Channel distribution | `GET /v1/analytics/channels?from=...&to=...` | `fetchChannelMetrics()` |
| Revenue / engagement trend | `GET /v1/analytics/trends/customer_engagement` | `fetchTrend('customer_engagement', '7d')` |
| Real-time counters | `GET /v1/analytics/real-time?metrics=activeAgents,messagesInFlight,hitlPending` | `fetchRealTimeCounters()` |
| Agent performance | `GET /v1/analytics/agents` | `fetchAgentMetrics()` |

**Component-level data binding:**

| Component | Field rendered | API field path |
|-----------|---------------|----------------|
| "Total Customers" KPI card | `formatNumber(kpis.totalCustomers)` | `DashboardSummary.totalCustomers` |
| "Active Agents" KPI card | `kpis.activeAgents` | `DashboardSummary.activeAgents` |
| "Compliance Score" KPI card | `kpis.complianceScore` | `DashboardSummary.complianceScore` |
| "Revenue Collected" KPI card | `formatCurrency(kpis.revenueCollected)` | `DashboardSummary.revenueCollected` |
| "HITL Pending" badge | `kpis.hitlPending` | `DashboardSummary.hitlPending` |
| DonutChart (channel distribution) | `[{ label, value, color }]` | `ChannelMetricsResponse.channels[*].{ channel, volume }` |
| AreaChart (revenue/engagement trend) | `[{ x: date, y: value }]` | `TrendResponse.data[*].{ date, value }` |
| SparkLine (customers, 7d) | `number[]` | Derived from 7-day `fetchTrend('customer_engagement')` |
| StatusDot grid (system health) | `{ name, status, latency }` | `GET /v1/health` (existing health endpoint) |

**Key change:** Remove all `mockKpis`, `mockAgentPerf`, `mockDeliveryTrend`, `mockChannelDistribution`, and `mockRevenueTrend` constants. Replace with `useState` initialized to `null` + `Skeleton` components during load. Keep `Promise.allSettled` pattern so partial failures degrade gracefully.

**Auto-refresh:** Add a 30-second polling interval using `useInterval` hook (new shared hook in `apps/web/src/hooks/useInterval.ts`).

### 7B.2 — Customers.tsx

**File:** `apps/web/src/pages/Customers.tsx`

**Current state:** Has API call structure but imports from `apiClient` directly. Types partially match.

**Wire to:** `apps/web/src/lib/customers-api.ts`

**Changes:**
1. Replace direct `apiClient.get` calls with `listCustomers(params)`.
2. Replace `apiClient.post` create call with `createCustomer(body)`.
3. The `Customer` type in the page must extend (or match) `customers-api.ts:Customer`. Resolve the `lifecycleStage` discrepancy: the page uses `'onboarding' | 'at-risk'` but the backend schema uses `'qualified' | 'churning'`. Update the page's local type to match backend exactly and update badge/color maps accordingly.
4. Add `updateCustomer` wiring in edit modal (currently no edit modal exists — add one reusing the create modal with pre-filled fields).
5. Add delete confirmation using existing `Modal` component.

**Component-level data binding:**

| Component | Field | API source |
|-----------|-------|-----------|
| Table row: Name | `customer.name` | `Customer.name` |
| Table row: Email | `customer.email ?? '—'` | `Customer.email` |
| Table row: Status badge | `statusBadge[customer.status]` | `Customer.status` |
| Table row: Lifecycle badge | `lifecycleBadge[customer.lifecycleStage]` | `Customer.lifecycleStage` |
| Table row: Health score dot | `healthScoreColor(customer.healthScore ?? 0)` | `Customer.healthScore` |
| Table row: Last contact | `formatDate(customer.updatedAt)` | `Customer.updatedAt` |
| Pagination: total count | `response.total` | `CustomerListResponse.total` |
| Search input | `params.search` → re-fetch | `CustomerListParams.search` |

### 7B.3 — AgentActivity.tsx

**File:** `apps/web/src/pages/AgentActivity.tsx`

**Wire to:** `apps/web/src/lib/agents-api.ts`

**Endpoints:**

| Data | Endpoint | Service function |
|------|----------|-----------------|
| Session list | `GET /v1/agents/sessions` | `listSessions()` |
| Session detail | `GET /v1/agents/sessions/:id` | `getSession()` |
| HITL queue | `GET /v1/agents/hitl` | `listHitl()` |
| Kill session | `POST /v1/agents/sessions/:id/kill` | `killSession()` |
| Approve HITL | `POST /v1/agents/hitl/:id/approve` | `approveHitl()` |
| Reject HITL | `POST /v1/agents/hitl/:id/reject` | `rejectHitl()` |
| Trigger new session | `POST /v1/agents/trigger` | `triggerAgent()` |

**Component-level data binding:**

| Component | Field | API source |
|-----------|-------|-----------|
| Session table: Agent role badge | `session.agentRole` | `AgentSession.agentRole` |
| Session table: Status badge | `session.status` | `AgentSession.status` |
| Session table: Steps | `${session.steps.length} steps` | `AgentSession.steps` |
| Session table: Cost | `formatCurrency(session.costCents / 100)` | `AgentSession.costCents` |
| GaugeChart: Confidence | `session.confidenceScore ?? 0` | `AgentSession.confidenceScore` |
| AgentFlowGraph: Steps | `session.steps.map(s => ({ label: s.action, tool: s.toolUsed, approved: s.approved }))` | `AgentSession.steps` |
| HITL card: Action | `item.action` | `HitlItem.action` |
| HITL card: Reason | `item.reason` | `HitlItem.reason` |
| HITL card: Expires | `formatRelativeTime(item.expiresAt)` | `HitlItem.expiresAt` |
| Kill button | fires `killSession(session.id, { reason })` | — |

**Real-time:** Subscribe to SSE channel `agents.*` events. When `agent.session_completed` or `agent.hitl_created` arrives, re-fetch the relevant list without a full page reload.

### 7B.4 — Interactions.tsx

**File:** `apps/web/src/pages/Interactions.tsx`

**Wire to:** `apps/web/src/lib/messages-api.ts`

**Endpoint:** `GET /v1/messages` with filter params.

**Component-level data binding:**

| Component | Field | API source |
|-----------|-------|-----------|
| Row: Channel icon | `channelIconColor[msg.channel]` | `MessageMetadata.channel` |
| Row: Direction badge | `msg.direction` | `MessageMetadata.direction` |
| Row: Status badge | `statusBadge[msg.status]` | `MessageMetadata.status` |
| Row: Timestamp | `formatRelativeTime(msg.sentAt ?? msg.createdAt)` | `MessageMetadata.sentAt` |
| Row: Correlation ID | `msg.correlationId` (monospace, truncated) | `MessageMetadata.correlationId` |
| Row: Sentiment dot | Derived from `msg` — see Phase 7E for live sentiment | Stub as `neutral` until Phase 7E |
| Filter: Channel select | `params.channel` | `MessageListParams.channel` |
| Filter: Status select | `params.status` | `MessageListParams.status` |
| Filter: Direction toggle | `params.direction` | `MessageListParams.direction` |

**Note:** Per HIPAA §164.312 and the existing compliance comment in `routes/messages.ts`, message content is NEVER rendered — only metadata. The `sentiment` field on `InteractionMeta` currently comes from a local type. Stub it as `'neutral'` until Phase 7E wires the sentiment analyzer.

---

## Phase 7C — Intelligence Pages: Analytics, Compliance, Healthcare

### 7C.1 — Analytics.tsx

**File:** `apps/web/src/pages/Analytics.tsx`

**Current state:** Already imports from `analytics-api.ts` and calls `fetchChannelMetrics`, `fetchAgentMetrics`, etc. However, the endpoint URLs in `analytics-api.ts` do not match the backend routes exactly.

**URL corrections needed in `analytics-api.ts`:**

| Current (wrong) | Correct (matches backend) |
|----------------|--------------------------|
| `/v1/analytics/summary` | `/v1/analytics/dashboard` |
| `/v1/analytics/channels?range=7d` | `/v1/analytics/channels?from=<ISO>&to=<ISO>&granularity=day` |
| `/v1/analytics/agents?range=7d` | `/v1/analytics/agents?from=<ISO>&to=<ISO>&granularity=day` |
| `/v1/analytics/compliance?range=7d` | `/v1/analytics/compliance?from=<ISO>&to=<ISO>&granularity=day` |
| `/v1/analytics/trends/:metric?range=7d` | `/v1/analytics/trends/:metric?from=<ISO>&to=<ISO>&granularity=day` |
| `/v1/analytics/real-time-counters` | `/v1/analytics/real-time?metrics=activeAgents,messagesInFlight,hitlPending,complianceScore,eventsPerMinute` |

**Add helper to `analytics-api.ts`:**
```typescript
// Convert TimeRange shorthand to ISO from/to pair
export function timeRangeToParams(range: TimeRange): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  switch (range) {
    case '24h': from.setHours(from.getHours() - 24); break;
    case '7d':  from.setDate(from.getDate() - 7);    break;
    case '30d': from.setDate(from.getDate() - 30);   break;
    case '90d': from.setDate(from.getDate() - 90);   break;
    default:    from.setDate(from.getDate() - 7);    break;
  }
  return { from: from.toISOString(), to: to.toISOString() };
}
```

**Component-level data binding:**

| Chart | Fields | API source |
|-------|--------|-----------|
| BarChart: Channel delivery rates | `[{ label: ch.channel, value: ch.deliveryRate }]` | `ChannelMetricsResponse.channels` |
| LineChart: Channel volume over time | `channelVolume.data` mapped to series per channel | `ChannelMetricsResponse.volumeOverTime` |
| Table: Agent metrics | One row per `AgentMetricRow` | `AgentMetricsResponse.agents` |
| LineChart: Agent resolution trend | `agentTrend.map(p => ({ x: p.date, y: p.resolutionRate }))` | `AgentMetricsResponse.trend` |
| LineChart: Compliance score | `scoreTrend.map(p => ({ x: p.date, y: p.score }))` | `ComplianceMetricsResponse.scoreTrend` |
| BarChart: Violation breakdown | `violationBreakdown` | `ComplianceMetricsResponse.violationBreakdown` |
| DonutChart: Check pass/fail ratios | `checkRatios` | `ComplianceMetricsResponse.checkRatios` |
| HeatmapChart: Engagement heatmap | Derived from `customer_engagement` trend data | `TrendResponse.data` |

**Mock data cleanup:** Remove all `mockChannelMetrics`, `mockChannelVolume`, `mockAgentMetrics`, `mockAgentTrend`, `mockComplianceTrend`, `mockViolations`, `mockCheckRatios` constants. Replace with `null` initial state and `Skeleton` placeholders.

### 7C.2 — Compliance.tsx

**File:** `apps/web/src/pages/Compliance.tsx`

**Wire to:** `apps/web/src/lib/compliance-api.ts` (new from Phase 7A)

**Endpoints:**

| Data | Endpoint | Service function |
|------|----------|-----------------|
| Overview card | `GET /v1/compliance/summary` | `getComplianceSummary()` |
| Violation list | `GET /v1/compliance/violations` | `listViolations()` |
| Consent status | `GET /v1/compliance/consent-status` | `getConsentStatus()` |
| Regulation breakdown | `GET /v1/compliance/regulations` | `getRegulationBreakdown()` |

**Note:** The backend currently has `GET /v1/analytics/compliance` which returns compliance metrics (score trend, violations). The compliance-specific endpoints (`/v1/compliance/*`) may not exist yet — see **Backend Gap** section below.

**Component-level data binding:**

| Component | Field | API source |
|-----------|-------|-----------|
| Score gauge | `overview.score` | `ComplianceSummary.score` |
| "Last Audit" text | `formatDate(overview.lastAuditAt)` | `ComplianceSummary.lastAuditAt` |
| "Critical Violations" counter | `overview.criticalViolations` | `ComplianceSummary.criticalViolations` |
| DonutChart: Regulation distribution | `[{ label: r.regulation, value: r.violations }]` | `RegulationBreakdown[]` |
| Violation table: Rule | `v.rule` | `ComplianceViolation.rule` |
| Violation table: Regulation badge | `v.regulation` | `ComplianceViolation.regulation` |
| Violation table: Severity badge | `v.severity` | `ComplianceViolation.severity` |
| Violation table: Timestamp | `formatRelativeTime(v.timestamp)` | `ComplianceViolation.timestamp` |
| Violation table: Resolve button | fires `resolveViolation(v.id)` | — |
| Consent table: Channel | `c.channel` | `ConsentStatus.channel` |
| ProgressBar: Consent rate | `c.percentage` | `ConsentStatus.percentage` |
| Regulation filter | `params.regulation` → re-fetch | `ViolationListParams.regulation` |

### 7C.3 — HealthcareDashboard.tsx

**File:** `apps/web/src/pages/HealthcareDashboard.tsx`

**Wire to:** Combination of `analytics-api.ts` (compliance metrics) + domain-specific healthcare endpoints.

**HIPAA Note:** All patient identifiers must remain tokenized. The `patientToken` field is a UUID-based reference — never a real name. No PHI is rendered. Server-side enforces this.

**Endpoints:**

| Data | Endpoint | Notes |
|------|----------|-------|
| Compliance score | `GET /v1/analytics/dashboard` | Filter `complianceScore` field only |
| Agent session queue | `GET /v1/agents/sessions?status=active&agentRole=support_triage` | Filter for healthcare-relevant roles |
| Upcoming appointments | `GET /v1/healthcare/appointments` | **Backend gap — see below** |
| Patient queue | `GET /v1/healthcare/queue` | **Backend gap — see below** |

**Component-level data binding:**

| Component | Field | API source |
|-----------|-------|-----------|
| GaugeChart: HIPAA compliance | `complianceScore` | `DashboardSummary.complianceScore` |
| Queue list: tokenId | `item.tokenId` | `PatientQueueItem.tokenId` |
| Queue list: priority badge | `item.priority` | `PatientQueueItem.priority` |
| Queue list: wait time | `${item.waitMinutes}m` | `PatientQueueItem.waitMinutes` |
| Appointment table: type | `item.type` | `AppointmentItem.type` |
| Appointment table: scheduled | `formatTime(item.scheduledAt)` | `AppointmentItem.scheduledAt` |
| AI Insight panel | LLM-generated summary | Phase 7E `GET /v1/ai/healthcare/insights` |

---

## Phase 7D — Platform Pages: Marketplace, Developer, Partner, Settings, Team

### 7D.1 — Marketplace.tsx

**File:** `apps/web/src/pages/Marketplace.tsx`

**Wire to:** `apps/web/src/lib/marketplace-api.ts`

**Component-level data binding:**

| Component | Field | API source |
|-----------|-------|-----------|
| Agent card: Name | `agent.name` | `MarketplaceAgent.name` |
| Agent card: Version badge | `agent.version` | `MarketplaceAgent.version` |
| Agent card: Rating stars | `agent.rating ?? 0` | `MarketplaceAgent.rating` |
| Agent card: Downloads | `formatNumber(agent.downloadCount)` | `MarketplaceAgent.downloadCount` |
| Agent card: Author | `agent.author` | `MarketplaceAgent.author` |
| Agent card: Category badge | `agent.category ?? 'General'` | `MarketplaceAgent.category` |
| Agent card: Status badge | `agent.status` | `MarketplaceAgent.status` |
| Install button | fires `installAgent(agent.id)` | — |
| Review modal: Rating | Star selector → `body.rating` | `ReviewBody.rating` |
| Review modal: Comment | Textarea → `body.comment` | `ReviewBody.comment` |
| Search input | `params.search` → re-fetch | `MarketplaceListParams.search` |
| Category filter tabs | `params.category` → re-fetch | `MarketplaceListParams.category` |
| Pagination | `limit` + `offset` | `MarketplaceListResponse.total` |

### 7D.2 — DeveloperConsole.tsx

**File:** `apps/web/src/pages/DeveloperConsole.tsx`

**Wire to:** `apps/web/src/lib/developer-api.ts`

**Component-level data binding:**

| Component | Field | API source |
|-----------|-------|-----------|
| Profile card: name/email/tier | `profile.name`, `.email`, `.tier` | `DeveloperProfile` |
| API key table: prefix | `key.prefix` | `ApiKeyItem.prefix` |
| API key table: name | `key.name` | `ApiKeyItem.name` |
| API key table: created | `formatDate(key.createdAt)` | `ApiKeyItem.createdAt` |
| API key table: expires | `key.expiresAt ? formatDate(key.expiresAt) : 'Never'` | `ApiKeyItem.expiresAt` |
| API key table: status dot | `key.revokedAt ? 'error' : 'success'` | `ApiKeyItem.revokedAt` |
| "Create key" modal result | One-time display of `rawKey` | `ApiKeyCreateResponse.rawKey` |
| Revoke button | fires `revokeApiKey(key.id)` | — |
| Sandbox table: name | `sandbox.name` | `SandboxTenant.name` |
| Sandbox table: status dot | `sandbox.status` | `SandboxTenant.status` |
| Destroy sandbox button | fires `destroySandbox(sandbox.id)` | — |

**Security note:** `rawKey` must be displayed in a one-time modal and NEVER stored in React state beyond the modal's lifecycle. After the modal closes, the key is gone from the client. Add a "Copy to clipboard" button using `navigator.clipboard.writeText()`.

### 7D.3 — PartnerDashboard.tsx

**File:** `apps/web/src/pages/PartnerDashboard.tsx`

**Wire to:** `apps/web/src/lib/partners-api.ts`

**Component-level data binding:**

| Component | Field | API source |
|-----------|-------|-----------|
| Profile card: name/company/tier | `profile.name`, `.company`, `.tier` | `PartnerProfile` |
| Tier badge | `profile.tier` | `PartnerProfile.tier` |
| Revenue share | `${profile.revenueSharePct}%` | `PartnerProfile.revenueSharePct` |
| "Total earnings" KPI | `formatCurrency(earnings.totalCents / 100)` | `EarningsSummary.totalCents` |
| "Pending" KPI | `formatCurrency(earnings.pendingCents / 100)` | `EarningsSummary.pendingCents` |
| "Paid" KPI | `formatCurrency(earnings.paidCents / 100)` | `EarningsSummary.paidCents` |
| Payouts table: amount | `formatCurrency(p.amountCents / 100)` | `PayoutRecord.amountCents` |
| Payouts table: period | `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` | `PayoutRecord.periodStart/End` |
| Payouts table: status badge | `p.status` | `PayoutRecord.status` |
| AreaChart: earnings over time | Derived from `payouts` sorted by `periodEnd` | `PayoutRecord[]` |

### 7D.4 — Settings.tsx

**File:** `apps/web/src/pages/Settings.tsx`

**Current state:** Already imports `fetchTenantSettings`, `fetchSsoConnections`, etc. from `settings-api.ts`. The `settings-api.ts` functions need URL corrections to match actual routes.

**URL corrections in `settings-api.ts`:**

| Current | Correct |
|---------|---------|
| `/v1/settings/tenant` | `/v1/organizations` (PATCH first org in list) |
| `/v1/settings/sso` | `/v1/sso/connections` |
| `/v1/settings/roles` | `/v1/roles` |
| `/v1/settings/branding` | `/v1/branding` |

**Component-level data binding:**

| Component | Field | API source |
|-----------|-------|-----------|
| Organization name input | `settings.organizationName` | `TenantSettings.organizationName` |
| Brand color input | `settings.brandColor` | `TenantSettings.brandColor` |
| SSO connections table | `connections` list | `SsoConnection[]` |
| Roles table: name | `role.name` | `CustomRole.name` |
| Roles table: user count | `role.userCount` | `CustomRole.userCount` |
| Agent config: confidence threshold | `agentConfig.confidenceThreshold` | `AgentConfig.confidenceThreshold` |
| Agent config: kill switch toggle | `agentConfig.globalKillSwitch` | `AgentConfig.globalKillSwitch` |
| Channel priority list | `channels` ordered by `priority` | `ChannelConfig[]` |
| MFA toggle | `security.mfaEnforced` | `SecurityConfig.mfaEnforced` |

### 7D.5 — TeamManagement.tsx

**File:** `apps/web/src/pages/TeamManagement.tsx`

**Current state:** Already imports from `settings-api.ts`. Functions `fetchTeamMembers`, `inviteMember`, etc. exist but hit wrong URLs.

**URL corrections in `settings-api.ts`:**

| Current | Correct |
|---------|---------|
| `/v1/settings/team` | `/v1/organizations/:id/members` |
| `/v1/settings/team/invite` | `/v1/organizations/:id/members/invite` |

**Component-level data binding:**

| Component | Field | API source |
|-----------|-------|-----------|
| Member table: Avatar | `<Avatar name={m.name} />` | `TeamMember.name` |
| Member table: email | `m.email` | `TeamMember.email` |
| Member table: role badge | `m.role` | `TeamMember.role` |
| Member table: status dot | `m.status` | `TeamMember.status` |
| Member table: last active | `formatRelativeTime(m.lastActive)` | `TeamMember.lastActive` |
| Invite modal: email input | `body.email` | — |
| Invite modal: role select | `body.role` (populated from `fetchRoles()`) | — |
| Change role dropdown | fires `updateMemberRole(m.id, newRole)` | — |
| Suspend button | fires `suspendMember(m.id)` | — |
| Remove button | fires `removeMember(m.id)` | — |

---

## Phase 7E — Real-Time, ML Features, End-to-End Testing

### 7E.1 — Real-Time SSE Hook

**New file:** `apps/web/src/hooks/useRealtimeEvents.ts`

```typescript
import { useEffect, useRef, useCallback } from 'react';
import { getAccessToken } from '../lib/api';

type EventHandler = (data: Record<string, unknown>) => void;

interface UseRealtimeEventsOptions {
  /** SSE endpoint — defaults to /v1/events/stream */
  endpoint?: string;
  /** Filter to specific event categories */
  categories?: string[];
  /** Reconnect on disconnect? Default true */
  reconnect?: boolean;
}

export function useRealtimeEvents(
  handlers: Record<string, EventHandler>,
  options: UseRealtimeEventsOptions = {},
): void {
  const {
    endpoint = '/api/v1/events/stream',
    reconnect = true,
  } = options;

  const sourceRef = useRef<EventSource | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    const token = getAccessToken();
    if (!token) return;

    // SSE does not support custom headers — pass token via query param
    // Backend must accept ?token=... for SSE auth (SOC2 CC6.1 — alternate auth for SSE)
    const url = `${endpoint}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    sourceRef.current = es;

    es.onmessage = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as { type: string; data: Record<string, unknown> };
        const handler = handlersRef.current[parsed.type];
        if (handler) handler(parsed.data);
      } catch {
        // Malformed event — ignore
      }
    };

    es.onerror = () => {
      es.close();
      if (reconnect) {
        setTimeout(connect, 5000);
      }
    };
  }, [endpoint, reconnect]);

  useEffect(() => {
    connect();
    return () => {
      sourceRef.current?.close();
    };
  }, [connect]);
}
```

**Usage in Dashboard.tsx:**
```typescript
useRealtimeEvents({
  'agent.session_completed': () => void refetchAgentMetrics(),
  'agent.hitl_created':      () => void refetchHitlCount(),
  'analytics.counters_updated': (data) => setRealTimeCounters(data as RealTimeCounters),
});
```

**Usage in AgentActivity.tsx:**
```typescript
useRealtimeEvents({
  'agent.session_started':   () => void refetchSessions(),
  'agent.session_completed': () => void refetchSessions(),
  'agent.hitl_created':      () => void refetchHitl(),
});
```

### 7E.2 — Sentiment Analysis Wiring (Backend → Frontend)

**Existing backend:** `packages/ai/src/sentiment.ts` has `SentimentAnalyzer` class with `analyze()` and `analyzeBatch()`. It uses a `SentimentBackend` interface — needs to be wired to `LLMClient`.

**New backend file:** `packages/ai/src/sentiment-backend-llm.ts`

```typescript
// Wires SentimentBackend to LLMClient for production use
// Uses 'budget' tier (claude-haiku-4-5) for high-volume, low-cost analysis
// SECURITY: Input is pre-sanitized by SentimentAnalyzer — NO PHI enters the LLM prompt
```

**New backend route:** `POST /v1/ai/sentiment` (add to `apps/api/src/routes/analytics.ts` or a new `apps/api/src/routes/ai.ts`)

```typescript
// Request body:
interface SentimentRequest {
  readonly texts: string[];  // Max 50, max 10000 chars each — validated by Zod
  // NO customer IDs, NO names — caller passes only sanitized text tokens
}

// Response:
interface SentimentResponse {
  readonly results: Array<{
    readonly score: number;      // -1.0 to 1.0
    readonly label: 'positive' | 'neutral' | 'negative';
    readonly confidence: number; // 0.0 to 1.0
  }>;
  readonly modelUsed: string;
  readonly costCents: number;
}
```

**Wire to Interactions.tsx:** After fetching message metadata, call `POST /v1/ai/sentiment` with message correlation IDs (not content) to get trend data. The backend resolves content ref internally — the frontend never sees content.

**Service function in `apps/web/src/lib/ai-api.ts` (NEW):**

```typescript
import { apiClient } from './api';

export interface SentimentRequest {
  readonly texts: string[];
}

export interface SentimentResultItem {
  readonly score: number;
  readonly label: 'positive' | 'neutral' | 'negative';
  readonly confidence: number;
}

export interface SentimentResponse {
  readonly results: SentimentResultItem[];
  readonly modelUsed: string;
  readonly costCents: number;
}

export function analyzeSentiment(body: SentimentRequest): Promise<SentimentResponse> {
  return apiClient.post<SentimentResponse>('/v1/ai/sentiment', body);
}

// Agent insight generation — uses 'standard' tier (claude-sonnet-4-6)
export interface AgentInsightRequest {
  readonly customerId: string;
  readonly sessionId: string;
  readonly context: 'churn_risk' | 'upsell' | 'support' | 'healthcare';
}

export interface AgentInsightResponse {
  readonly summary: string;        // Max 500 chars — no PHI
  readonly recommendedAction: string;
  readonly confidence: number;
  readonly modelUsed: string;
  readonly costCents: number;
}

export function getAgentInsight(body: AgentInsightRequest): Promise<AgentInsightResponse> {
  return apiClient.post<AgentInsightResponse>('/v1/ai/insight', body);
}
```

### 7E.3 — Embedding / Semantic Search

**Existing backend:** `packages/ai/src/embeddings.ts` has `EmbeddingClient`. This powers semantic customer search.

**New backend endpoint:** `GET /v1/customers/search?q=<query>&limit=10` — uses embedding similarity to find customers beyond exact-text match.

**Frontend change in Customers.tsx:** When `params.search` length > 3 characters, debounce 300ms then call semantic search endpoint instead of the text-match endpoint.

**Service function addition to `customers-api.ts`:**

```typescript
export interface SemanticSearchResult {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly score: number;  // Similarity 0–1
}

export function semanticSearchCustomers(
  query: string,
  limit = 10,
): Promise<{ data: SemanticSearchResult[] }> {
  return apiClient.get<{ data: SemanticSearchResult[] }>(
    `/v1/customers/search?q=${encodeURIComponent(query)}&limit=${limit}`,
  );
}
```

### 7E.4 — Entity Routing Visualization

**Existing backend:** `packages/ai/src/routing/sentiment-router.ts` has `SentimentRouter` producing `RoutingDecision`.

**New backend endpoint:** `GET /v1/agents/routing-decisions?customerId=<id>&limit=20`

**Frontend use in CustomerDetail.tsx (existing page):**
```typescript
// Render routing history for a customer:
// - Action badge (escalate_human / route_retention / keep_current / route_growth)
// - Trend direction indicator (improving / stable / declining)
// - Confidence gauge
// - Timestamp
```

### 7E.5 — Shared Hooks

**New file:** `apps/web/src/hooks/useInterval.ts`

```typescript
import { useEffect, useRef } from 'react';

export function useInterval(callback: () => void, delay: number | null): void {
  const savedCallback = useRef(callback);
  savedCallback.current = callback;

  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => { savedCallback.current(); }, delay);
    return () => clearInterval(id);
  }, [delay]);
}
```

**New file:** `apps/web/src/hooks/useAsync.ts`

```typescript
import { useState, useCallback, useRef } from 'react';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export function useAsync<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): AsyncState<T> & { refetch: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const execute = useCallback(() => {
    setState(s => ({ ...s, loading: true, error: null }));
    fnRef.current()
      .then(data => setState({ data, loading: false, error: null }))
      .catch(error => setState(s => ({ ...s, loading: false, error: error as Error })));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, refetch: execute };
}
```

---

## Backend Gaps Identified (Must Be Resolved Before Frontend Wiring)

The following endpoints are expected by the frontend plan but do not exist in the current 19 route files:

| Missing Endpoint | Expected by | Priority | Effort |
|-----------------|-------------|----------|--------|
| `GET /v1/compliance/summary` | Compliance.tsx | HIGH | 2h |
| `GET /v1/compliance/violations` | Compliance.tsx | HIGH | 2h |
| `POST /v1/compliance/violations/:id/resolve` | Compliance.tsx | HIGH | 1h |
| `GET /v1/compliance/consent-status` | Compliance.tsx | HIGH | 2h |
| `GET /v1/compliance/regulations` | Compliance.tsx | MEDIUM | 1h |
| `GET /v1/analytics/dashboard` | Dashboard.tsx | HIGH | Already exists — URL alias needed |
| `POST /v1/ai/sentiment` | Interactions.tsx | HIGH | 3h |
| `POST /v1/ai/insight` | CustomerDetail, Healthcare | MEDIUM | 4h |
| `GET /v1/customers/search` | Customers.tsx | MEDIUM | 3h |
| `GET /v1/agents/routing-decisions` | CustomerDetail.tsx | LOW | 2h |
| `GET /v1/healthcare/appointments` | HealthcareDashboard.tsx | MEDIUM | 4h |
| `GET /v1/healthcare/queue` | HealthcareDashboard.tsx | MEDIUM | 4h |

**Recommendation:** Create `apps/api/src/routes/compliance-dashboard.ts` and `apps/api/src/routes/ai.ts` and `apps/api/src/routes/healthcare.ts` as the three new route files. Keep each focused. Use the same Hono + Zod + `requireAuth` + `requirePermissionMiddleware` pattern as existing routes.

---

## Environment Variables Required

Add to `apps/api/.env.example`:

```dotenv
# LLM (Phase 7A)
ANTHROPIC_API_KEY=sk-ant-...

# SSE auth (Phase 7E)
SSE_TOKEN_SECRET=...

# Embeddings (Phase 7E.3)
OPENAI_API_KEY=sk-...  # Used only for Voyage/embedding if not using Anthropic native
```

Add to `apps/web/.env.example`:

```dotenv
VITE_API_BASE_URL=http://localhost:3000/api
```

The `VITE_API_BASE_URL` is already consumed by `apps/web/src/lib/api.ts` line 57.

---

## File-by-File Change Summary

### New Files (Frontend — `apps/web/src/lib/`)

| File | Phase | Purpose |
|------|-------|---------|
| `customers-api.ts` | 7A | Customer CRUD service module |
| `agents-api.ts` | 7A | Agent session + HITL service module |
| `messages-api.ts` | 7A | Message metadata service module |
| `compliance-api.ts` | 7A | Compliance summary + violations module |
| `marketplace-api.ts` | 7A | Marketplace CRUD + reviews module |
| `developer-api.ts` | 7A | API keys + sandbox module |
| `partners-api.ts` | 7A | Partner profile + payouts module |
| `organizations-api.ts` | 7A | Organization hierarchy module |
| `ai-api.ts` | 7E | Sentiment + insight AI service module |

### New Files (Frontend — `apps/web/src/hooks/`)

| File | Phase | Purpose |
|------|-------|---------|
| `useInterval.ts` | 7E | Polling interval hook |
| `useAsync.ts` | 7E | Async state management hook |
| `useRealtimeEvents.ts` | 7E | SSE subscription hook |

### Modified Files (Frontend — Pages)

| File | Phase | Changes |
|------|-------|---------|
| `pages/Dashboard.tsx` | 7B | Replace 6 mock constants with real API calls |
| `pages/Customers.tsx` | 7B | Wire to customers-api, fix lifecycle types |
| `pages/AgentActivity.tsx` | 7B | Wire to agents-api, add real HITL flow |
| `pages/Interactions.tsx` | 7B | Wire to messages-api, stub sentiment |
| `pages/Analytics.tsx` | 7C | Fix URL params, remove all mock data |
| `pages/Compliance.tsx` | 7C | Wire to compliance-api |
| `pages/HealthcareDashboard.tsx` | 7C | Wire analytics + new healthcare endpoints |
| `pages/Marketplace.tsx` | 7D | Wire to marketplace-api |
| `pages/DeveloperConsole.tsx` | 7D | Wire to developer-api |
| `pages/PartnerDashboard.tsx` | 7D | Wire to partners-api |
| `pages/Settings.tsx` | 7D | Fix URL paths in settings-api |
| `pages/TeamManagement.tsx` | 7D | Fix URL paths in settings-api |
| `pages/Interactions.tsx` | 7E | Add live sentiment from ai-api |

### Modified Files (Frontend — Lib)

| File | Phase | Changes |
|------|-------|---------|
| `lib/analytics-api.ts` | 7C | Fix all endpoint URLs, add `timeRangeToParams` |
| `lib/settings-api.ts` | 7D | Fix all endpoint URLs to match actual routes |

### Modified Files (Backend)

| File | Phase | Changes |
|------|-------|---------|
| `apps/api/src/index.ts` | 7A | Wire `LLMClient` with `ANTHROPIC_API_KEY` |
| `packages/ai/src/models.ts` | 7A | Update `modelName` to `claude-sonnet-4-6` / `claude-opus-4-6` |

### New Files (Backend)

| File | Phase | Purpose |
|------|-------|---------|
| `apps/api/src/routes/compliance-dashboard.ts` | 7C | Compliance summary, violations, consent |
| `apps/api/src/routes/ai.ts` | 7E | Sentiment analysis + insight endpoints |
| `apps/api/src/routes/healthcare.ts` | 7C | Patient queue + appointment endpoints |
| `packages/ai/src/sentiment-backend-llm.ts` | 7E | `LLMClient`-backed `SentimentBackend` |

---

## Testing Approach Per Phase

### Phase 7A Testing

```
packages/ai/src/__tests__/client.live.test.ts
  - Skip unless ANTHROPIC_API_KEY set in env
  - Complete(budget/standard/premium) → assert non-empty content
  - Retry on 429 → mock Anthropic server with jest-mock-extended

apps/web/src/__tests__/lib/customers-api.test.ts
  - listCustomers({ status: 'active' }) → fetch called with ?status=active
  - createCustomer({}) → POST /v1/customers
  - getCustomer('uuid') → GET /v1/customers/uuid
  (Use MSW for all browser-side API mocks)
```

### Phase 7B Testing

```
apps/web/src/__tests__/pages/Dashboard.test.tsx
  - Renders Skeleton while loading
  - Renders KPI values from mocked API response
  - Refresh button re-triggers fetch

apps/web/src/__tests__/pages/Customers.test.tsx
  - Search input debounces 300ms then calls listCustomers
  - Create modal submits to createCustomer
  - LifecycleStage enum values match backend exactly

apps/web/src/__tests__/pages/AgentActivity.test.tsx
  - Kill button opens confirm modal, then calls killSession
  - Approve HITL calls approveHitl with empty notes
  - Reject HITL requires reason field
```

### Phase 7C Testing

```
apps/web/src/__tests__/lib/analytics-api.test.ts
  - timeRangeToParams('7d') → from is 7 days ago (±1 second)
  - fetchChannelMetrics('30d') → URL contains from/to ISO strings

apps/web/src/__tests__/pages/Compliance.test.tsx
  - Resolve violation button calls resolveViolation
  - Regulation filter changes query params
```

### Phase 7D Testing

```
apps/web/src/__tests__/pages/DeveloperConsole.test.tsx
  - rawKey displayed in one-time modal
  - Modal close clears rawKey from state (re-open shows nothing)
  - Copy button calls navigator.clipboard.writeText

apps/web/src/__tests__/pages/Marketplace.test.tsx
  - Install fires installAgent
  - Review modal validates rating 1–5
```

### Phase 7E Testing

```
apps/web/src/__tests__/hooks/useRealtimeEvents.test.ts
  - Connects to SSE endpoint with token query param
  - Calls correct handler on matching event type
  - Reconnects after 5s on connection error

packages/ai/src/__tests__/sentiment-backend-llm.test.ts
  - analyze() passes sanitized text (not original) to LLMClient
  - Returns score clamped to [-1.0, 1.0]
  - Budget tier used (not standard/premium)

Integration: POST /v1/ai/sentiment (tests/integration/ai.test.ts)
  - Rejects texts array > 50 items (422)
  - Rejects individual text > 10000 chars (422)
  - Returns results array of same length as input
```

---

## Compliance Notes

| Control | Requirement | Implementation |
|---------|------------|---------------|
| HIPAA §164.312(a)(1) | Access control | JWT from in-memory store; tenant scoping on all endpoints |
| HIPAA §164.312(b) | Audit controls | Every mutation includes `X-Request-Id`; backend logs to WORM audit store |
| HIPAA §164.312(e)(1) | Transmission security | All API calls over TLS; SSE token via query param (not in path) |
| SOC2 CC6.1 | Access control | RBAC enforced server-side on every endpoint; frontend shows UI elements only for permitted roles |
| SOC2 CC7.2 | Monitoring | Real-time events logged; sentiment anomalies trigger routing decisions |
| GDPR Art. 5 | Data minimization | Message content never returned in API responses; only metadata |
| FDCPA / TCPA | Consent | `ConsentManager.check()` called before every outbound SMS/voice |
| HIPAA / ML | PHI in prompts | Sentiment analysis uses sanitized, non-identifying text tokens only |
| SOC2 / Budget | Cost governance | Every LLM call tracked via `costCents`; budget cap enforced in `LLMClient.complete()` |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Backend compliance endpoints not implemented | High | Blocks 7C | Build `compliance-dashboard.ts` in parallel with 7A |
| `ANTHROPIC_API_KEY` not provisioned in staging | Medium | Blocks 7E | Set up secret in CI and staging env on Day 1 |
| SSE token auth pattern not implemented | Medium | Blocks 7E.1 | Alternative: fall back to polling via `useInterval` |
| Type mismatch between frontend `LifecycleStage` and backend enum | High (known) | Breaks Customers page | Fix in 7B immediately — mapped in plan |
| LLM latency in sentiment batch > 5s | Low | Degrades Interactions page | Implement background processing; show spinner |
| Real-time event volume overloads SSE connections | Low | Degrades all real-time pages | Add event throttling in `useRealtimeEvents` |

---

## Definition of Done Per Phase

**Phase 7A:** All 9 new service modules exist. TypeScript compiler reports zero errors on service files. All service function unit tests pass. `LLMClient` instantiates without error when `ANTHROPIC_API_KEY` is set.

**Phase 7B:** Dashboard, Customers, AgentActivity, Interactions pages render live data in development environment. No mock constant arrays remain in those four files. All page-level tests pass.

**Phase 7C:** Analytics URL corrections applied and verified against backend route handlers. Compliance page wired and shows live violation list. Healthcare page degrades gracefully when healthcare-specific endpoints not yet live.

**Phase 7D:** Marketplace, DeveloperConsole, PartnerDashboard, Settings, TeamManagement pages wired. One-time API key display verified manually. All page tests pass.

**Phase 7E:** `useRealtimeEvents` hook connects to SSE and triggers re-fetches. Sentiment score appears on Interactions page rows. Semantic search activates after 300ms debounce. Full integration test suite passes with `ANTHROPIC_API_KEY` set.

---

*End of IMPLEMENTATION-PLAN-PHASE7.md*