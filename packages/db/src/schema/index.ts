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
  developerUsage,
  sandboxTenants,
  sandboxStatusEnum,
  seedDataProfileEnum,
} from './developer.js';

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
