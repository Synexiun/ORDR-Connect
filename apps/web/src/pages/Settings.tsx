import { type ReactNode } from 'react';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';

export function Settings(): ReactNode {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-content">Settings</h1>
        <p className="mt-1 text-sm text-content-secondary">
          Tenant configuration and system preferences
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Tenant Settings */}
        <Card title="Tenant Settings" actions={<Badge variant="info" size="sm">Managed</Badge>}>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Organization Name</p>
                <p className="text-xs text-content-tertiary">Your tenant display name</p>
              </div>
              <span className="text-sm text-content-secondary">Configure via API</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Timezone</p>
                <p className="text-xs text-content-tertiary">Affects TCPA quiet hours enforcement</p>
              </div>
              <span className="text-sm text-content-secondary">UTC</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Data Retention</p>
                <p className="text-xs text-content-tertiary">HIPAA minimum: 6 years</p>
              </div>
              <span className="text-sm text-content-secondary">7 years</span>
            </div>
          </div>
        </Card>

        {/* SSO Configuration */}
        <Card title="SSO Configuration" actions={<Badge variant="info" size="sm">WorkOS</Badge>}>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Okta SAML</p>
                <p className="text-xs text-content-tertiary">Enterprise SSO via SAML 2.0</p>
              </div>
              <Badge variant="success" dot size="sm">Connected</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Google Workspace</p>
                <p className="text-xs text-content-tertiary">OAuth 2.1 + PKCE</p>
              </div>
              <Badge variant="success" dot size="sm">Connected</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Azure AD</p>
                <p className="text-xs text-content-tertiary">OIDC federation</p>
              </div>
              <Badge variant="neutral" size="sm">Not Configured</Badge>
            </div>
            <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-3 text-center">
              <p className="text-xs text-content-tertiary">+ Add SSO Connection</p>
              <p className="mt-0.5 text-2xs text-content-tertiary">Supports SAML, OIDC, OAuth 2.1</p>
            </div>
          </div>
        </Card>

        {/* Custom Roles */}
        <Card title="Custom Roles" actions={<Badge variant="warning" size="sm">RBAC + ABAC</Badge>}>
          <div className="space-y-4">
            {[
              { name: 'Admin', permissions: ['full-access'], badge: 'danger' as const },
              { name: 'Operator', permissions: ['read', 'write', 'agent-control'], badge: 'warning' as const },
              { name: 'Analyst', permissions: ['read', 'analytics'], badge: 'info' as const },
              { name: 'Auditor', permissions: ['read', 'audit-logs', 'compliance'], badge: 'neutral' as const },
            ].map((role) => (
              <div key={role.name} className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-content">{role.name}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {role.permissions.map((perm) => (
                      <Badge key={perm} variant="neutral" size="sm">{perm}</Badge>
                    ))}
                  </div>
                </div>
                <Badge variant={role.badge} size="sm">{role.name}</Badge>
              </div>
            ))}
            <div className="rounded-lg border border-dashed border-border bg-surface px-4 py-3 text-center">
              <p className="text-xs text-content-tertiary">+ Create Custom Role</p>
              <p className="mt-0.5 text-2xs text-content-tertiary">Define permissions per resource</p>
            </div>
          </div>
        </Card>

        {/* Agent Configuration */}
        <Card title="Agent Configuration" actions={<Badge variant="warning" size="sm">Safety Bounded</Badge>}>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Confidence Threshold</p>
                <p className="text-xs text-content-tertiary">Actions below this trigger HITL review</p>
              </div>
              <span className="font-mono text-sm text-amber-400">0.70</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Max Actions Per Session</p>
                <p className="text-xs text-content-tertiary">Agent budget limit per execution</p>
              </div>
              <span className="font-mono text-sm text-content-secondary">25</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Cost Limit Per Session</p>
                <p className="text-xs text-content-tertiary">Maximum USD spend per agent run</p>
              </div>
              <span className="font-mono text-sm text-content-secondary">$1.00</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Global Kill Switch</p>
                <p className="text-xs text-content-tertiary">Immediately halt all agent operations</p>
              </div>
              <Badge variant="success" dot size="sm">Agents Active</Badge>
            </div>

            {/* Autonomy levels per agent role */}
            <div className="border-t border-border pt-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-content-secondary">Autonomy Levels</p>
              {[
                { role: 'Collection', level: 'Semi-autonomous', budget: '$1.00' },
                { role: 'Onboarding', level: 'Fully autonomous', budget: '$0.50' },
                { role: 'Support', level: 'Semi-autonomous', budget: '$1.50' },
                { role: 'Retention', level: 'Human-in-loop', budget: '$2.00' },
              ].map((agent) => (
                <div key={agent.role} className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-2.5 mb-2 last:mb-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-content">{agent.role}</span>
                    <Badge variant={
                      agent.level === 'Fully autonomous' ? 'success' :
                      agent.level === 'Semi-autonomous' ? 'warning' : 'info'
                    } size="sm">{agent.level}</Badge>
                  </div>
                  <span className="font-mono text-xs text-content-tertiary">Budget: {agent.budget}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Channel Preferences Defaults */}
        <Card title="Channel Preferences Defaults">
          <div className="space-y-4">
            {[
              { channel: 'Email', priority: 1, enabled: true },
              { channel: 'SMS', priority: 2, enabled: true },
              { channel: 'Voice', priority: 3, enabled: true },
              { channel: 'WhatsApp', priority: 4, enabled: false },
              { channel: 'Chat', priority: 5, enabled: true },
            ].map((ch) => (
              <div key={ch.channel} className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-surface-tertiary text-2xs font-bold text-content-secondary">
                    {ch.priority}
                  </span>
                  <p className="text-sm font-medium text-content">{ch.channel}</p>
                </div>
                <Badge variant={ch.enabled ? 'success' : 'neutral'} size="sm">
                  {ch.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        {/* Notification Preferences */}
        <Card title="Notification Preferences">
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Compliance Violations</p>
                <p className="text-xs text-content-tertiary">Alert on critical/high violations</p>
              </div>
              <Badge variant="success" size="sm">Enabled</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Agent HITL Requests</p>
                <p className="text-xs text-content-tertiary">Notify when agents need human review</p>
              </div>
              <Badge variant="success" size="sm">Enabled</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Audit Chain Alerts</p>
                <p className="text-xs text-content-tertiary">P0 alert if hash chain integrity fails</p>
              </div>
              <Badge variant="success" size="sm">Enabled</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Daily Summary</p>
                <p className="text-xs text-content-tertiary">Operations summary via email</p>
              </div>
              <Badge variant="neutral" size="sm">Disabled</Badge>
            </div>
          </div>
        </Card>

        {/* Security */}
        <Card title="Security" actions={<Badge variant="success" size="sm">Hardened</Badge>}>
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Encryption</p>
                <p className="text-xs text-content-tertiary">At rest and in transit</p>
              </div>
              <span className="text-xs text-emerald-400">AES-256-GCM / TLS 1.3</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Key Rotation</p>
                <p className="text-xs text-content-tertiary">Automated rotation cycle</p>
              </div>
              <span className="text-xs text-content-secondary">90-day maximum</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Audit Log Integrity</p>
                <p className="text-xs text-content-tertiary">SHA-256 hash chain + Merkle tree</p>
              </div>
              <Badge variant="success" dot size="sm">Verified</Badge>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <p className="text-sm font-medium text-content">Session Security</p>
                <p className="text-xs text-content-tertiary">In-memory tokens, no browser storage</p>
              </div>
              <Badge variant="success" dot size="sm">HIPAA Compliant</Badge>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
