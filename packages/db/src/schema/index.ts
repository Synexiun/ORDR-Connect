// ---------------------------------------------------------------------------
// @ordr/db — Schema barrel export
//
// Every table, enum, and relation is re-exported from here.
// Import as: import * as schema from '@ordr/db/schema'
// ---------------------------------------------------------------------------

// Tenants
export { tenants, planEnum, tenantStatusEnum, isolationTierEnum } from './tenants.js';

// Users
export { users, userRoleEnum, userStatusEnum } from './users.js';

// Sessions
export { sessions } from './sessions.js';

// API Keys
export { apiKeys } from './api-keys.js';

// Customers
export {
  customers,
  customerTypeEnum,
  customerStatusEnum,
  lifecycleStageEnum,
} from './customers.js';

// Interactions
export { interactions, channelEnum, directionEnum, interactionTypeEnum } from './interactions.js';

// Audit Logs (WORM — immutable)
export { auditLogs, actorTypeEnum } from './audit-logs.js';

// Merkle Roots (audit chain verification)
export { merkleRoots } from './merkle-roots.js';

// Agent Actions
export { agentActions } from './agent-actions.js';

// Compliance Records
export { complianceRecords, complianceResultEnum } from './compliance-records.js';

// Contacts
export { contacts, contactChannelEnum, consentStatusEnum } from './contacts.js';

// Consent Records (WORM — immutable)
export { consentRecords, consentActionEnum, consentMethodEnum } from './consent-records.js';

// Agent Sessions
export { agentSessions, agentSessionStatusEnum, autonomyLevelEnum } from './agent-sessions.js';

// Messages
export { messages, messageDirectionEnum, messageStatusEnum } from './messages.js';

// Payment Records
export { paymentRecords, paymentStatusEnum, paymentMethodEnum } from './payment-records.js';

// Decision Rules
export { decisionRules } from './decision-rules.js';

// Decision Audit (WORM — immutable)
export { decisionAudit } from './decision-audit.js';

// Decision Log — per-decision outcome summary (WORM — immutable)
export { decisionLog } from './decision-log.js';

// Channel Preferences
export { channelPreferences } from './channel-preferences.js';

// Organizations
export { organizations } from './organizations.js';

// SSO Connections
export {
  ssoConnections,
  ssoConnectionTypeEnum,
  ssoConnectionStatusEnum,
} from './sso-connections.js';

// Custom Roles
export { customRoles, userCustomRoles } from './custom-roles.js';

// SCIM Tokens
export { scimTokens } from './scim-tokens.js';

// White-Label Configs
export { whiteLabelConfigs } from './white-label.js';

// Developer Portal
export {
  developerAccounts,
  developerTierEnum,
  developerStatusEnum,
  developerApiKeys,
  developerUsage,
  sandboxTenants,
  sandboxStatusEnum,
  seedDataProfileEnum,
} from './developer.js';

// Developer Webhooks (Phase 53)
export { developerWebhooks } from './developer-webhooks.js';

// Marketplace
export {
  marketplaceAgents,
  marketplaceAgentStatusEnum,
  marketplaceReviews,
  marketplaceInstalls,
  marketplaceInstallStatusEnum,
} from './marketplace.js';

// Memory (Agent Long-Term Memory + Sentiment History)
export { agentMemories, sentimentHistory, sentimentLabelEnum } from './memory.js';

// Partners
export {
  partners,
  partnerPayouts,
  partnerReferrals,
  partnerTierEnum,
  partnerStatusEnum,
  partnerPayoutStatusEnum,
} from './partners.js';

// Notifications
export { notifications, notificationTypeEnum, notificationSeverityEnum } from './notifications.js';

// Billing (customers, subscriptions, usage)
export { billingCustomers } from './billing-customers.js';

export { subscriptions, subscriptionStatusEnum } from './subscriptions.js';

export { usageRecords, usageResourceEnum } from './usage-records.js';

// Support Tickets
export {
  tickets,
  ticketMessages,
  ticketStatusEnum,
  ticketPriorityEnum,
  ticketCategoryEnum,
  ticketMessageAuthorRoleEnum,
} from './tickets.js';

// Reports (generated reports + schedules)
export {
  generatedReports,
  reportSchedules,
  reportTypeEnum,
  reportStatusEnum,
  scheduleFrequencyEnum,
  scheduleStatusEnum,
} from './reports.js';

// Workflow (definitions, instances, step results)
export {
  workflowDefinitions,
  workflowInstances,
  workflowStepResults,
  workflowStatusEnum,
  stepStatusEnum,
  stepTypeEnum,
  triggerTypeEnum,
} from './workflow.js';

// Scheduler (job definitions, instances, dead letters)
export {
  jobDefinitions,
  jobInstances,
  jobDeadLetters,
  jobStatusEnum,
  jobPriorityEnum,
} from './scheduler.js';

// Search Index (tsvector full-text search)
export { searchIndex, searchEntityTypeEnum } from './search-index.js';

// DSR — GDPR Data Subject Requests
export { dataSubjectRequests, dsrExports, dsrTypeEnum, dsrStatusEnum } from './dsr.js';

// Integrations (Phase 52)
export {
  integrationConfigs,
  syncEvents,
  webhookLogs,
  integrationFieldMappings,
  integrationEntityMappings,
  integrationProviderEnum,
  integrationConfigStatusEnum,
  syncEventDirectionEnum,
  syncEventStatusEnum,
  integrationEntityTypeEnum,
  fieldMappingDirectionEnum,
} from './integrations.js';

// Encrypted Fields + Key Rotation Jobs (Phase 55)
export { encryptedFields } from './encrypted-fields.js';
export { keyRotationJobs } from './key-rotation-jobs.js';

// SCIM Groups + Group Members (Phase 56)
export { groups } from './groups.js';
export { groupMembers } from './group-members.js';

// WorkOS Webhook Events (Phase 56)
export { workosEvents } from './workos-events.js';

// Feature Flags (Phase 57)
export { featureFlags } from './feature-flags.js';

// Compliance Violations (Phase 58)
export {
  complianceViolations,
  violationRegulationEnum,
  violationSeverityEnum,
} from './compliance-violations.js';

// Internal Messaging — enterprise chat channels and messages (Phase 70)
export { chatChannels, channelTypeEnum } from './chat-channels.js';
export { chatMessages, messageContentTypeEnum } from './chat-messages.js';

// SLA Policies (Phase 100)
export { slaPolicies } from './sla.js';
