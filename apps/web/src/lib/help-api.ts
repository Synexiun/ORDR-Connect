/**
 * Help Center API — Types, mock data, and fetch functions.
 *
 * COMPLIANCE:
 * - No PHI/PII in help content (Rule 6)
 * - All API calls use apiClient with correlation ID (Rule 3)
 * - Error responses return safe generic messages (Rule 7)
 */

import { apiClient } from './api';

// --- Types ---

export interface HelpCategory {
  id: string;
  name: string;
  icon: string;
  articleCount: number;
  description: string;
}

export interface HelpArticle {
  id: string;
  slug: string;
  title: string;
  category: string;
  content: string;
  lastUpdated: string;
  helpfulYes: number;
  helpfulNo: number;
  relatedArticles: string[];
}

export interface HelpSearchResult {
  articles: HelpArticle[];
  total: number;
}

// --- Mock Data ---

const mockCategories: HelpCategory[] = [
  {
    id: 'cat-getting-started',
    name: 'Getting Started',
    icon: 'PlayCircle',
    articleCount: 3,
    description:
      'Set up your account, configure your workspace, and learn the basics of ORDR-Connect.',
  },
  {
    id: 'cat-dashboard',
    name: 'Dashboard & Analytics',
    icon: 'BarChart3',
    articleCount: 2,
    description: 'Understand your KPIs, customize dashboards, and interpret analytics data.',
  },
  {
    id: 'cat-agents',
    name: 'Agent Management',
    icon: 'Bot',
    articleCount: 2,
    description: 'Deploy, configure, and monitor AI agents across your customer operations.',
  },
  {
    id: 'cat-compliance',
    name: 'Compliance',
    icon: 'ShieldCheck',
    articleCount: 2,
    description: 'SOC 2, ISO 27001, and HIPAA compliance controls, audit logs, and data handling.',
  },
  {
    id: 'cat-api',
    name: 'API & Integrations',
    icon: 'Code',
    articleCount: 2,
    description: 'REST API reference, webhook setup, and third-party integration guides.',
  },
  {
    id: 'cat-faq',
    name: 'FAQ',
    icon: 'HelpCircle',
    articleCount: 1,
    description: 'Frequently asked questions about billing, security, and platform capabilities.',
  },
];

const mockArticles: HelpArticle[] = [
  // Getting Started
  {
    id: 'art-001',
    slug: 'creating-your-account',
    title: 'Creating Your Account',
    category: 'cat-getting-started',
    content: `When you first receive your ORDR-Connect invitation, click the activation link in the email to set up your credentials. You will be prompted to configure multi-factor authentication before accessing the platform, as MFA is mandatory for all user accounts under our SOC 2 and HIPAA compliance requirements.

After verifying your identity, you will land on the onboarding wizard. This guided setup walks you through selecting your timezone, configuring notification preferences, and reviewing your assigned role permissions. Each role in the system follows the principle of least privilege, so you will only see features relevant to your responsibilities.

Once onboarding is complete, your account is fully active. You can access the Dashboard immediately, and your administrator can adjust your role or permissions at any time through the Settings panel.`,
    lastUpdated: '2026-03-20T10:00:00Z',
    helpfulYes: 47,
    helpfulNo: 3,
    relatedArticles: ['configuring-workspace', 'understanding-roles'],
  },
  {
    id: 'art-002',
    slug: 'configuring-workspace',
    title: 'Configuring Your Workspace',
    category: 'cat-getting-started',
    content: `Your workspace is the central hub where all customer operations converge. To configure it, navigate to Settings and select the Workspace tab. Here you can set your organization name, upload a logo, and choose a color theme that matches your brand identity.

The workspace configuration also includes tenant-level settings such as default communication channels, working hours, and escalation policies. These settings apply to all agents and team members within your tenant. Changes are versioned and logged in the audit trail for compliance purposes.

For multi-team setups, you can create sub-workspaces with distinct configurations. Each sub-workspace inherits the parent compliance policies but can customize operational parameters such as SLA targets and routing rules.`,
    lastUpdated: '2026-03-18T14:30:00Z',
    helpfulYes: 32,
    helpfulNo: 5,
    relatedArticles: ['creating-your-account', 'understanding-roles'],
  },
  {
    id: 'art-003',
    slug: 'understanding-roles',
    title: 'Understanding Roles & Permissions',
    category: 'cat-getting-started',
    content: `ORDR-Connect uses a combined Role-Based and Attribute-Based Access Control model (RBAC + ABAC). Every user is assigned a primary role such as Admin, Operator, Analyst, or Viewer. Each role defines a baseline set of permissions that determine which pages, actions, and data are accessible.

Beyond the primary role, Attribute-Based policies refine access based on contextual factors like department, time of day, and data sensitivity level. For example, an Operator in the collections department can view customer payment histories, but the same Operator in support cannot, even though both share the Operator role.

Administrators can manage roles from the Settings panel under Access Control. All permission changes are logged in the immutable audit trail and require a confirmation step. Bulk role assignments are supported for onboarding new teams efficiently.`,
    lastUpdated: '2026-03-15T09:00:00Z',
    helpfulYes: 58,
    helpfulNo: 2,
    relatedArticles: ['creating-your-account', 'compliance-overview'],
  },
  // Dashboard & Analytics
  {
    id: 'art-004',
    slug: 'reading-your-dashboard',
    title: 'Reading Your Dashboard',
    category: 'cat-dashboard',
    content: `The Dashboard is the first screen you see after logging in. It provides a real-time overview of your customer operations through a set of KPI cards at the top, including Total Customers, Active Agents, Compliance Score, Revenue Collected, and Messages Delivered.

Below the KPIs, the Dashboard shows trend charts for message volume by channel, agent performance over time, and compliance score history. Each chart supports time range filtering from 24 hours up to 90 days. Hover over any data point to see the exact value and timestamp.

The Activity Feed on the right side displays a chronological stream of significant events, including agent decisions, escalations, compliance alerts, and customer interactions. Events are color-coded by severity and can be filtered by type for focused monitoring.`,
    lastUpdated: '2026-03-22T11:00:00Z',
    helpfulYes: 41,
    helpfulNo: 4,
    relatedArticles: ['analytics-deep-dive', 'configuring-workspace'],
  },
  {
    id: 'art-005',
    slug: 'analytics-deep-dive',
    title: 'Analytics Deep Dive',
    category: 'cat-dashboard',
    content: `The Analytics page provides granular insight into three key domains: Channel Performance, Agent Metrics, and Compliance Trends. Use the tab navigation at the top to switch between views, and the time range selector to adjust the reporting period.

Channel Performance shows delivery rates, failure rates, cost per message, and volume across SMS, Email, Voice, and WhatsApp. The stacked area chart visualizes volume trends over time, making it easy to spot seasonal patterns or anomalies in communication flow.

Agent Metrics displays a table of all active agent roles with their session counts, resolution rates, average confidence scores, and cost per session. The trend line below tracks resolution rate over time. Agents with confidence scores below 0.7 are flagged for human review, consistent with the platform safety controls.`,
    lastUpdated: '2026-03-21T16:00:00Z',
    helpfulYes: 29,
    helpfulNo: 6,
    relatedArticles: ['reading-your-dashboard', 'agent-deployment'],
  },
  // Agent Management
  {
    id: 'art-006',
    slug: 'agent-deployment',
    title: 'Deploying AI Agents',
    category: 'cat-agents',
    content: `AI Agents in ORDR-Connect are deployed through the Agent Activity page. Each agent operates within a sandboxed execution environment with explicit tool permissions, token budgets, and action limits. To deploy a new agent, click the Deploy button and select an agent template from the Marketplace.

During deployment, you configure the agent's scope: which customer segments it can access, which communication channels it may use, and what actions it can perform autonomously versus those requiring human-in-the-loop approval. All financial actions and PHI access always require HITL regardless of agent configuration.

Once deployed, the agent enters a warm-up phase where it processes a small batch of interactions under full human review. After passing the warm-up criteria, it transitions to autonomous mode. You can pause, resume, or terminate any agent instantly using the kill switch available on its detail card.`,
    lastUpdated: '2026-03-19T13:00:00Z',
    helpfulYes: 53,
    helpfulNo: 1,
    relatedArticles: ['agent-monitoring', 'analytics-deep-dive'],
  },
  {
    id: 'art-007',
    slug: 'agent-monitoring',
    title: 'Monitoring Agent Performance',
    category: 'cat-agents',
    content: `Every agent action is logged in the immutable WORM audit trail with the full reasoning chain: prompt input, context used, output generated, confidence score, and final action taken. You can review this chain from the Agent Activity page by clicking on any agent session.

The Agent Flow Graph provides a visual representation of the decision tree an agent follows during a session. Nodes represent decision points, and edges show the chosen paths with associated confidence scores. Red-highlighted nodes indicate where the agent deferred to human review.

Performance alerts are configured automatically. If an agent's resolution rate drops below the threshold, or if confidence scores trend downward, the system generates an alert in the Notifications panel and optionally pauses the agent for review. These thresholds can be customized per agent role in Settings.`,
    lastUpdated: '2026-03-17T10:30:00Z',
    helpfulYes: 36,
    helpfulNo: 3,
    relatedArticles: ['agent-deployment', 'reading-your-dashboard'],
  },
  // Compliance
  {
    id: 'art-008',
    slug: 'compliance-overview',
    title: 'Compliance Overview',
    category: 'cat-compliance',
    content: `ORDR-Connect is built with SOC 2 Type II, ISO 27001:2022, and HIPAA compliance hardcoded into every layer. The Compliance page provides a real-time score reflecting the percentage of automated checks currently passing across all three frameworks.

The violations table shows any detected compliance events, categorized by regulation and severity. Critical violations trigger immediate alerts and may automatically pause affected operations. Each violation includes a description, the affected resource, and resolution status. Resolved violations remain visible for audit purposes.

Consent tracking is displayed at the bottom of the Compliance page. It shows per-channel opt-in rates and flags any customers whose consent has expired or been revoked. Communications to non-consented customers are automatically blocked by the compliance rules engine.`,
    lastUpdated: '2026-03-23T08:00:00Z',
    helpfulYes: 62,
    helpfulNo: 1,
    relatedArticles: ['audit-log-guide', 'understanding-roles'],
  },
  {
    id: 'art-009',
    slug: 'audit-log-guide',
    title: 'Using the Audit Log',
    category: 'cat-compliance',
    content: `The Audit Log is an immutable, append-only record of every state change, data access, agent decision, and API call in the system. Each entry is cryptographically chained using SHA-256 hashes, with Merkle tree roots generated every 1,000 events for batch verification.

To search the Audit Log, use the filters at the top of the page. You can filter by action type, user, resource, time range, and severity. Each entry displays a correlation ID that can be used to trace an action across services for incident investigation.

The Audit Log cannot be modified or deleted. Entries are replicated to S3 Object Lock in compliance mode with a 7-year retention policy. Automated integrity checks run continuously and alert the compliance team if any hash chain break is detected.`,
    lastUpdated: '2026-03-16T12:00:00Z',
    helpfulYes: 44,
    helpfulNo: 2,
    relatedArticles: ['compliance-overview', 'configuring-workspace'],
  },
  // API & Integrations
  {
    id: 'art-010',
    slug: 'rest-api-quickstart',
    title: 'REST API Quickstart',
    category: 'cat-api',
    content: `The ORDR-Connect REST API follows standard conventions with JSON request and response bodies. All endpoints require authentication via Bearer token in the Authorization header. Tokens are issued through the OAuth 2.1 + PKCE flow and have a maximum lifetime of 15 minutes for service-to-service calls.

Every API request must include an X-Request-Id header for audit trail correlation. If omitted, the server generates one automatically. Rate limiting is enforced per-tenant and per-endpoint using a sliding window algorithm. Current limits are documented in the Developer Console.

The base URL is available in your workspace settings. API versioning uses path-based prefixes such as /v1/. Breaking changes result in a new version prefix, and previous versions remain supported for a minimum of 12 months after deprecation notice.`,
    lastUpdated: '2026-03-14T15:00:00Z',
    helpfulYes: 71,
    helpfulNo: 4,
    relatedArticles: ['webhook-configuration', 'rest-api-quickstart'],
  },
  {
    id: 'art-011',
    slug: 'webhook-configuration',
    title: 'Configuring Webhooks',
    category: 'cat-api',
    content: `Webhooks allow ORDR-Connect to push real-time events to your systems. To configure a webhook, navigate to the Developer Console and click Add Webhook. You will provide a target URL, select which event types to subscribe to, and set a signing secret for payload verification.

Every webhook delivery includes a signature header computed using HMAC-SHA256 with your signing secret. Your receiving endpoint should verify this signature before processing the payload to prevent spoofing. Failed deliveries are retried with exponential backoff up to 5 attempts over 24 hours.

Webhook logs are available in the Developer Console showing delivery status, response codes, and latency for each attempt. You can pause, test, or delete webhooks at any time. All webhook configuration changes are recorded in the audit trail.`,
    lastUpdated: '2026-03-13T11:00:00Z',
    helpfulYes: 38,
    helpfulNo: 2,
    relatedArticles: ['rest-api-quickstart', 'compliance-overview'],
  },
  // FAQ
  {
    id: 'art-012',
    slug: 'frequently-asked-questions',
    title: 'Frequently Asked Questions',
    category: 'cat-faq',
    content: `How is my data encrypted? All data at rest uses AES-256-GCM encryption. Data in transit is protected with TLS 1.3. PHI fields receive additional application-layer encryption before database storage, and encryption keys are managed through HSM-backed key management with automated 90-day rotation.

What happens if an AI agent makes an error? Every agent action is reversible or flagged as irreversible before execution. If an error is detected, the agent can be immediately terminated via the kill switch, and affected actions can be rolled back. All agent decisions include a full reasoning chain in the audit log for investigation.

How do I contact support? You can submit a support ticket directly from the Tickets page in the sidebar. Our support team operates under strict SLA commitments. Critical issues receive a response within 1 hour, and all ticket conversations are encrypted and logged in the compliance audit trail.`,
    lastUpdated: '2026-03-24T09:00:00Z',
    helpfulYes: 85,
    helpfulNo: 7,
    relatedArticles: ['creating-your-account', 'compliance-overview'],
  },
];

// --- Fetch Functions ---

export async function fetchCategories(): Promise<HelpCategory[]> {
  try {
    return await apiClient.get<HelpCategory[]>('/v1/help/categories');
  } catch {
    return mockCategories;
  }
}

export async function fetchArticles(categoryId: string): Promise<HelpArticle[]> {
  try {
    return await apiClient.get<HelpArticle[]>(`/v1/help/categories/${categoryId}/articles`);
  } catch {
    return mockArticles.filter((a) => a.category === categoryId);
  }
}

export async function fetchArticle(slug: string): Promise<HelpArticle | null> {
  try {
    return await apiClient.get<HelpArticle>(`/v1/help/articles/${slug}`);
  } catch {
    return mockArticles.find((a) => a.slug === slug) ?? null;
  }
}

export async function searchHelp(query: string): Promise<HelpSearchResult> {
  try {
    return await apiClient.get<HelpSearchResult>(`/v1/help/search?q=${encodeURIComponent(query)}`);
  } catch {
    const q = query.toLowerCase();
    const matched = mockArticles.filter(
      (a) => a.title.toLowerCase().includes(q) || a.content.toLowerCase().includes(q),
    );
    return { articles: matched, total: matched.length };
  }
}

export async function submitFeedback(articleId: string, helpful: boolean): Promise<void> {
  try {
    await apiClient.post('/v1/help/feedback', { articleId, helpful });
  } catch {
    // Graceful degradation — feedback logged locally
  }
}

export { mockCategories, mockArticles };
