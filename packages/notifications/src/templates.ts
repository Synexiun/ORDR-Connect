/**
 * Notification Template Engine
 * Handlebars-based template rendering with a built-in template registry.
 * SECURITY: Templates are never sourced from user input.
 */
import Handlebars from 'handlebars';
import type { NotificationTemplate } from './types.js';

// ─── Built-in template registry ──────────────────────────────────────────────

const TEMPLATES: Record<string, NotificationTemplate> = {
  'hitl.approval_required': {
    subject: 'Action Required: Agent Awaiting Approval',
    body: 'Agent {{agentName}} is waiting for your approval on: {{actionDescription}}. Customer: {{customerName}}.',
    bodyHtml:
      '<p><strong>Agent {{agentName}}</strong> is waiting for your approval.</p><p>Action: {{actionDescription}}</p><p>Customer: <strong>{{customerName}}</strong></p>',
    actionLabel: 'Review Now',
  },
  'sla.breach': {
    subject: 'SLA Breach: {{customerName}}',
    body: 'SLA breach detected for customer {{customerName}}. Ticket #{{ticketId}} has been open for {{hoursOpen}} hours (limit: {{slaHours}} hours).',
  },
  'sla.at_risk': {
    subject: 'SLA At Risk: {{customerName}}',
    body: 'Customer {{customerName}} is approaching SLA breach. {{minutesRemaining}} minutes remaining on ticket #{{ticketId}}.',
  },
  'compliance.violation': {
    subject: '[WARNING] Compliance Violation Detected',
    body: 'A compliance violation has been detected: {{violationDescription}}. Severity: {{severity}}. Please review immediately.',
  },
  'security.alert': {
    subject: '[ALERT] Security Alert: {{alertType}}',
    body: 'Security alert: {{description}}. IP: {{ip}}. Time: {{timestamp}}. Please review your audit logs.',
  },
  'agent.escalation': {
    subject: 'Escalation: {{customerName}} needs human assistance',
    body: 'Customer {{customerName}} has been escalated and requires immediate human assistance. Reason: {{reason}}.',
  },
  'auth.mfa_code': {
    subject: 'Your verification code',
    body: 'Your ORDR-Connect verification code is: {{code}}. Valid for {{validMinutes}} minutes. Never share this code.',
  },
  'auth.login_alert': {
    subject: 'New login to your account',
    body: 'A new login to your ORDR-Connect account was detected from {{location}} ({{ip}}) at {{timestamp}}. If this was not you, contact your administrator immediately.',
  },
  'ticket.assigned': {
    subject: 'Ticket #{{ticketId}} assigned to you',
    body: 'Ticket #{{ticketId}} has been assigned to you. Subject: {{subject}}. Customer: {{customerName}}.',
  },
  'report.ready': {
    subject: 'Your report is ready',
    body: 'Report "{{reportName}}" generated on {{date}} is ready for download.',
  },
  'system.maintenance': {
    subject: 'Scheduled Maintenance: {{startTime}}',
    body: 'Scheduled maintenance will begin at {{startTime}} and is expected to last {{durationMinutes}} minutes. {{description}}',
  },
  'cobrowse.request': {
    subject: 'Remote assistance request',
    body: '{{adminName}} ({{adminRole}}) is requesting to view your screen to assist you. Session ID: {{sessionId}}. You will be prompted to accept or deny.',
  },
  'chat.mention': {
    subject: '{{senderName}} mentioned you in #{{channelName}}',
    body: '{{senderName}} mentioned you in #{{channelName}}: "{{messagePreview}}"',
  },
  'chat.direct_message': {
    subject: 'New message from {{senderName}}',
    body: '{{senderName}} sent you a message: "{{messagePreview}}"',
  },
};

export class TemplateEngine {
  private readonly registry = new Map<
    string,
    { compiled: Handlebars.TemplateDelegate; raw: NotificationTemplate }
  >();

  constructor() {
    for (const [name, tpl] of Object.entries(TEMPLATES)) {
      this.register(name, tpl);
    }
  }

  register(name: string, template: NotificationTemplate): void {
    this.registry.set(name, {
      raw: template,
      compiled: Handlebars.compile(template.body),
    });
  }

  render(
    nameOrTemplate: string | NotificationTemplate,
    data: Record<string, unknown>,
  ): NotificationTemplate {
    if (typeof nameOrTemplate !== 'string') {
      const body = Handlebars.compile(nameOrTemplate.body)(data);
      const subject =
        nameOrTemplate.subject !== undefined
          ? Handlebars.compile(nameOrTemplate.subject)(data)
          : undefined;
      const bodyHtml =
        nameOrTemplate.bodyHtml !== undefined
          ? Handlebars.compile(nameOrTemplate.bodyHtml)(data)
          : undefined;
      return {
        ...nameOrTemplate,
        body,
        ...(subject !== undefined ? { subject } : {}),
        ...(bodyHtml !== undefined ? { bodyHtml } : {}),
      };
    }
    const entry = this.registry.get(nameOrTemplate);
    if (entry === undefined) {
      throw new Error(`[ORDR:NOTIFICATIONS] Template not found: ${nameOrTemplate}`);
    }
    const body = entry.compiled(data);
    const subject =
      entry.raw.subject !== undefined ? Handlebars.compile(entry.raw.subject)(data) : undefined;
    const bodyHtml =
      entry.raw.bodyHtml !== undefined ? Handlebars.compile(entry.raw.bodyHtml)(data) : undefined;
    return {
      ...entry.raw,
      body,
      ...(subject !== undefined ? { subject } : {}),
      ...(bodyHtml !== undefined ? { bodyHtml } : {}),
    };
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  listTemplates(): string[] {
    return [...this.registry.keys()];
  }
}

export const templateEngine = new TemplateEngine();
