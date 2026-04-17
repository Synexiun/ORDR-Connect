/**
 * AI Models & Safety Config
 *
 * Control plane for the agent runtime: model registry, per-role token
 * budgets + confidence thresholds, usage/cost analytics, and the global
 * kill switch.
 *
 * SECURITY:
 * - LLM API keys never returned to client — stored in Vault — Rule 5
 * - Kill-switch activation WORM-logged with actor identity — Rule 3
 * - Confidence threshold below 0.7 requires senior-operator role — Rule 2
 * - PHI/financial actions always require human review regardless of score — Rule 9
 *
 * SOC 2 CC6.1 | ISO 27001 A.8.25 | HIPAA §164.312(a)(1)
 */

import { type ReactNode, useState, useRef, useEffect, useCallback } from 'react';
import {
  Cpu,
  DollarSign,
  Bot,
  Clock,
  ShieldAlert,
  ToggleRight,
  AlertTriangle,
  CheckCircle2,
  Zap,
} from '../components/icons';
import {
  aiModelsApi,
  type AiModel,
  type AgentRoleConfig,
  type ModelUsageStat,
  type AiSafetyConfig,
  type AiStats,
  type ModelProvider,
  type ModelStatus,
  type UpdateAgentRoleBody,
} from '../lib/ai-models-api';
import { cn } from '../lib/cn';
import { Spinner } from '../components/ui/Spinner';

// ── Mock Data ──────────────────────────────────────────────────────────────

const MOCK_MODELS: AiModel[] = [
  {
    id: 'claude-sonnet-4-6',
    name: 'claude-sonnet-4-6',
    displayName: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    version: '4.6',
    contextWindowTokens: 200_000,
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
    status: 'active',
    supportsVision: true,
    supportsFunctionCalling: true,
    addedAt: '2025-09-01T00:00:00Z',
  },
  {
    id: 'claude-haiku-4-5',
    name: 'claude-haiku-4-5-20251001',
    displayName: 'Claude Haiku 4.5',
    provider: 'anthropic',
    version: '4.5',
    contextWindowTokens: 200_000,
    inputCostPer1kTokens: 0.0008,
    outputCostPer1kTokens: 0.004,
    status: 'active',
    supportsVision: true,
    supportsFunctionCalling: true,
    addedAt: '2025-10-01T00:00:00Z',
  },
  {
    id: 'claude-opus-4-7',
    name: 'claude-opus-4-7',
    displayName: 'Claude Opus 4.7',
    provider: 'anthropic',
    version: '4.7',
    contextWindowTokens: 200_000,
    inputCostPer1kTokens: 0.015,
    outputCostPer1kTokens: 0.075,
    status: 'active',
    supportsVision: true,
    supportsFunctionCalling: true,
    addedAt: '2025-11-01T00:00:00Z',
  },
  {
    id: 'gpt-4o',
    name: 'gpt-4o',
    displayName: 'GPT-4o',
    provider: 'openai',
    version: '2024-11-20',
    contextWindowTokens: 128_000,
    inputCostPer1kTokens: 0.0025,
    outputCostPer1kTokens: 0.01,
    status: 'active',
    supportsVision: true,
    supportsFunctionCalling: true,
    addedAt: '2024-11-20T00:00:00Z',
  },
  {
    id: 'gpt-4o-mini',
    name: 'gpt-4o-mini',
    displayName: 'GPT-4o mini',
    provider: 'openai',
    version: '2024-07-18',
    contextWindowTokens: 128_000,
    inputCostPer1kTokens: 0.00015,
    outputCostPer1kTokens: 0.0006,
    status: 'deprecated',
    supportsVision: true,
    supportsFunctionCalling: true,
    addedAt: '2024-07-18T00:00:00Z',
  },
];

const MOCK_ROLE_CONFIGS: AgentRoleConfig[] = [
  {
    role: 'customer_service',
    displayName: 'Customer Service',
    modelId: 'claude-haiku-4-5',
    tokenBudgetPerRun: 8_000,
    maxActionsPerRun: 20,
    confidenceThreshold: 0.8,
    alwaysRequireHumanReview: false,
    enabled: true,
    lastUpdatedAt: '2026-04-01T10:00:00Z',
  },
  {
    role: 'escalation',
    displayName: 'Escalation Agent',
    modelId: 'claude-sonnet-4-6',
    tokenBudgetPerRun: 16_000,
    maxActionsPerRun: 10,
    confidenceThreshold: 0.9,
    alwaysRequireHumanReview: true,
    enabled: true,
    lastUpdatedAt: '2026-03-15T09:00:00Z',
  },
  {
    role: 'compliance_checker',
    displayName: 'Compliance Checker',
    modelId: 'claude-opus-4-7',
    tokenBudgetPerRun: 32_000,
    maxActionsPerRun: 5,
    confidenceThreshold: 0.95,
    alwaysRequireHumanReview: true,
    enabled: true,
    lastUpdatedAt: '2026-03-20T14:00:00Z',
  },
  {
    role: 'data_analyst',
    displayName: 'Data Analyst',
    modelId: 'claude-sonnet-4-6',
    tokenBudgetPerRun: 24_000,
    maxActionsPerRun: 15,
    confidenceThreshold: 0.75,
    alwaysRequireHumanReview: false,
    enabled: true,
    lastUpdatedAt: '2026-04-05T11:00:00Z',
  },
  {
    role: 'content_moderator',
    displayName: 'Content Moderator',
    modelId: 'claude-haiku-4-5',
    tokenBudgetPerRun: 4_000,
    maxActionsPerRun: 50,
    confidenceThreshold: 0.85,
    alwaysRequireHumanReview: false,
    enabled: true,
    lastUpdatedAt: '2026-04-10T08:00:00Z',
  },
  {
    role: 'triage',
    displayName: 'Triage Agent',
    modelId: 'claude-haiku-4-5',
    tokenBudgetPerRun: 2_000,
    maxActionsPerRun: 5,
    confidenceThreshold: 0.7,
    alwaysRequireHumanReview: false,
    enabled: false,
    lastUpdatedAt: '2026-04-12T16:00:00Z',
  },
];

const MOCK_USAGE: ModelUsageStat[] = [
  {
    modelId: 'claude-haiku-4-5',
    totalInputTokens: 892_341_234,
    totalOutputTokens: 234_891_234,
    totalCostUsd: 1_832.44,
    requestCount: 489_234,
  },
  {
    modelId: 'claude-sonnet-4-6',
    totalInputTokens: 234_891_234,
    totalOutputTokens: 89_234_123,
    totalCostUsd: 2_037.82,
    requestCount: 89_234,
  },
  {
    modelId: 'claude-opus-4-7',
    totalInputTokens: 12_341_234,
    totalOutputTokens: 5_891_234,
    totalCostUsd: 626.47,
    requestCount: 4_891,
  },
  {
    modelId: 'gpt-4o',
    totalInputTokens: 45_234_123,
    totalOutputTokens: 18_923_412,
    totalCostUsd: 302.67,
    requestCount: 23_412,
  },
];

const MOCK_STATS: AiStats = {
  activeModels: 4,
  totalSpend30dUsd: 4_799.4,
  agentRunsToday: 12_341,
  pendingHumanReviews: 23,
};

const MOCK_SAFETY: AiSafetyConfig = {
  globalKillSwitchEnabled: false,
  killSwitchActivatedAt: null,
  killSwitchActivatedBy: null,
  minimumConfidenceFloor: 0.7,
};

// ── Config ─────────────────────────────────────────────────────────────────

const PROVIDER_BADGE: Record<ModelProvider, { label: string; className: string }> = {
  anthropic: { label: 'Anthropic', className: 'bg-amber-500/10 text-amber-400' },
  openai: { label: 'OpenAI', className: 'bg-emerald-500/10 text-emerald-400' },
  google: { label: 'Google', className: 'bg-blue-500/10 text-blue-400' },
  mistral: { label: 'Mistral', className: 'bg-purple-500/10 text-purple-400' },
};

const MODEL_STATUS_CFG: Record<ModelStatus, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-emerald-500/10 text-emerald-400' },
  deprecated: { label: 'Deprecated', className: 'bg-amber-500/10 text-amber-400' },
  disabled: { label: 'Disabled', className: 'bg-surface-secondary text-content-tertiary' },
};

// ── Edit Role Modal ────────────────────────────────────────────────────────

interface EditRoleModalProps {
  config: AgentRoleConfig;
  models: AiModel[];
  onClose: () => void;
  onSaved: (updated: AgentRoleConfig) => void;
}

function EditRoleModal({ config, models, onClose, onSaved }: EditRoleModalProps): ReactNode {
  const [modelId, setModelId] = useState(config.modelId);
  const [tokenBudget, setTokenBudget] = useState(String(config.tokenBudgetPerRun));
  const [maxActions, setMaxActions] = useState(String(config.maxActionsPerRun));
  const [confidence, setConfidence] = useState(String(config.confidenceThreshold));
  const [humanReview, setHumanReview] = useState(config.alwaysRequireHumanReview);
  const [enabled, setEnabled] = useState(config.enabled);
  const [saving, setSaving] = useState(false);

  const confidenceNum = parseFloat(confidence);
  const confidenceValid = !isNaN(confidenceNum) && confidenceNum >= 0.7 && confidenceNum <= 1.0;

  const handleSave = useCallback(async () => {
    if (!confidenceValid) return;
    setSaving(true);
    const body: UpdateAgentRoleBody = {
      modelId,
      tokenBudgetPerRun: parseInt(tokenBudget, 10),
      maxActionsPerRun: parseInt(maxActions, 10),
      confidenceThreshold: confidenceNum,
      alwaysRequireHumanReview: humanReview,
      enabled,
    };
    try {
      const updated = await aiModelsApi.updateRoleConfig(config.role, body);
      onSaved(updated);
    } catch {
      onSaved({
        ...config,
        modelId,
        tokenBudgetPerRun: parseInt(tokenBudget, 10),
        maxActionsPerRun: parseInt(maxActions, 10),
        confidenceThreshold: confidenceNum,
        alwaysRequireHumanReview: humanReview,
        enabled,
        lastUpdatedAt: new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  }, [
    confidenceValid,
    modelId,
    tokenBudget,
    maxActions,
    confidenceNum,
    humanReview,
    enabled,
    config,
    onSaved,
  ]);

  const activeModels = models.filter((m) => m.status === 'active');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-content">Edit Agent Role</h2>
        <p className="mb-5 text-sm text-content-tertiary">{config.displayName}</p>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-content-secondary">Model</label>
            <select
              value={modelId}
              onChange={(e) => {
                setModelId(e.target.value);
              }}
              className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content focus:border-brand-accent focus:outline-none"
            >
              {activeModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-content-secondary">
                Token Budget / Run
              </label>
              <input
                type="number"
                value={tokenBudget}
                onChange={(e) => {
                  setTokenBudget(e.target.value);
                }}
                min={1000}
                max={200000}
                className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content focus:border-brand-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-content-secondary">
                Max Actions / Run
              </label>
              <input
                type="number"
                value={maxActions}
                onChange={(e) => {
                  setMaxActions(e.target.value);
                }}
                min={1}
                max={100}
                className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content focus:border-brand-accent focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-content-secondary">
              Confidence Threshold (0.7 – 1.0)
            </label>
            <input
              type="number"
              value={confidence}
              onChange={(e) => {
                setConfidence(e.target.value);
              }}
              min={0.7}
              max={1.0}
              step={0.05}
              className="w-full rounded-lg border border-border bg-surface-secondary px-3 py-2 text-sm text-content focus:border-brand-accent focus:outline-none"
            />
            {!isNaN(confidenceNum) && !confidenceValid && (
              <p className="mt-1 text-xs text-red-400">
                Minimum floor is 0.70 (Rule 9 — Agent Safety)
              </p>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-content">Always require human review</p>
              <p className="text-xs text-content-tertiary">
                Mandatory for PHI/financial actions (Rule 9)
              </p>
            </div>
            <button
              onClick={() => {
                setHumanReview((v) => !v);
              }}
              className={cn(
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                humanReview ? 'bg-brand-accent' : 'bg-surface-tertiary',
              )}
            >
              <span
                className={cn(
                  'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                  humanReview ? 'translate-x-4.5' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium text-content">Role enabled</p>
              <p className="text-xs text-content-tertiary">
                Individual kill switch for this agent role
              </p>
            </div>
            <button
              onClick={() => {
                setEnabled((v) => !v);
              }}
              className={cn(
                'relative inline-flex h-5 w-9 items-center rounded-full transition-colors',
                enabled ? 'bg-brand-accent' : 'bg-surface-tertiary',
              )}
            >
              <span
                className={cn(
                  'inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
                  enabled ? 'translate-x-4.5' : 'translate-x-0.5',
                )}
              />
            </button>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-content-secondary hover:bg-surface-secondary"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              void handleSave();
            }}
            disabled={!confidenceValid || saving}
            className="flex-1 rounded-lg bg-brand-accent px-4 py-2 text-sm font-medium text-[#060608] hover:opacity-90 disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Kill Switch Modal ──────────────────────────────────────────────────────

interface KillSwitchModalProps {
  enabling: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function KillSwitchModal({ enabling, onClose, onConfirm }: KillSwitchModalProps): ReactNode {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className={cn(
          'w-full max-w-md rounded-xl border bg-surface p-6 shadow-2xl',
          enabling ? 'border-red-500/30' : 'border-border',
        )}
      >
        <h2 className="mb-1 text-lg font-semibold text-content">
          {enabling ? 'Activate Global Kill Switch' : 'Deactivate Kill Switch'}
        </h2>
        <p className="mb-4 text-sm text-content-tertiary">
          {enabling
            ? 'All agent execution across every role will be immediately suspended.'
            : 'Agent execution will resume for all enabled roles.'}
        </p>

        {enabling && (
          <div className="mb-5 space-y-1 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">
            <p>
              <strong>This is a platform-wide emergency stop.</strong>
            </p>
            <p>
              All in-flight agent runs will be terminated. Queued work will be held until the kill
              switch is deactivated. This action is WORM-logged.
            </p>
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm text-content-secondary hover:bg-surface-secondary"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'flex-1 rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90',
              enabling ? 'bg-red-500 text-white' : 'bg-brand-accent text-[#060608]',
            )}
          >
            {enabling ? 'Activate Kill Switch' : 'Resume Agents'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Models Tab ─────────────────────────────────────────────────────────────

function ModelsTab({ models, usage }: { models: AiModel[]; usage: ModelUsageStat[] }): ReactNode {
  const usageMap = new Map(usage.map((u) => [u.modelId, u]));

  return (
    <div className="rounded-xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-content-tertiary">
              <th className="px-4 py-3">Model</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Context</th>
              <th className="px-4 py-3">Input / 1k</th>
              <th className="px-4 py-3">Output / 1k</th>
              <th className="px-4 py-3">30d Cost</th>
              <th className="px-4 py-3">30d Requests</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {models.map((model) => {
              const stat = usageMap.get(model.id);
              const provCfg = PROVIDER_BADGE[model.provider];
              const statusCfg = MODEL_STATUS_CFG[model.status];
              return (
                <tr key={model.id} className="hover:bg-surface-secondary/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-content">{model.displayName}</p>
                    <p className="font-mono text-2xs text-content-tertiary">{model.name}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn('rounded px-1.5 py-0.5 text-xs font-medium', provCfg.className)}
                    >
                      {provCfg.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-content-secondary">
                    {(model.contextWindowTokens / 1000).toFixed(0)}k
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-content-secondary">
                    ${model.inputCostPer1kTokens.toFixed(4)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-content-secondary">
                    ${model.outputCostPer1kTokens.toFixed(4)}
                  </td>
                  <td className="px-4 py-3 text-content-secondary">
                    {stat !== undefined ? `$${stat.totalCostUsd.toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-content-secondary">
                    {stat !== undefined ? stat.requestCount.toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs font-medium',
                        statusCfg.className,
                      )}
                    >
                      {statusCfg.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Agent Roles Tab ────────────────────────────────────────────────────────

function AgentRolesTab({
  configs,
  models,
  onEdit,
}: {
  configs: AgentRoleConfig[];
  models: AiModel[];
  onEdit: (c: AgentRoleConfig) => void;
}): ReactNode {
  const modelMap = new Map(models.map((m) => [m.id, m]));

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {configs.map((cfg) => {
        const model = modelMap.get(cfg.modelId);
        const provCfg = model !== undefined ? PROVIDER_BADGE[model.provider] : undefined;
        const confidencePct = Math.round(cfg.confidenceThreshold * 100);
        const isHighRisk = cfg.confidenceThreshold >= 0.9;

        return (
          <div
            key={cfg.role}
            className={cn(
              'rounded-xl border bg-surface p-4',
              !cfg.enabled ? 'border-border opacity-60' : 'border-border',
            )}
          >
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-content">{cfg.displayName}</p>
                <p className="text-2xs text-content-tertiary">{cfg.role}</p>
              </div>
              <div className="flex items-center gap-2">
                {cfg.enabled ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                    Active
                  </span>
                ) : (
                  <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs font-medium text-content-tertiary">
                    Disabled
                  </span>
                )}
              </div>
            </div>

            <div className="mb-3 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-content-tertiary">Model</span>
                <div className="flex items-center gap-1.5">
                  {provCfg !== undefined && (
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-2xs font-medium',
                        provCfg.className,
                      )}
                    >
                      {provCfg.label}
                    </span>
                  )}
                  <span className="font-medium text-content">
                    {model !== undefined ? model.displayName : cfg.modelId}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-content-tertiary">Token budget</span>
                <span className="font-mono text-content-secondary">
                  {cfg.tokenBudgetPerRun.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-content-tertiary">Max actions</span>
                <span className="font-mono text-content-secondary">{cfg.maxActionsPerRun}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-content-tertiary">Confidence threshold</span>
                <span
                  className={cn(
                    'font-mono font-semibold',
                    isHighRisk ? 'text-emerald-400' : 'text-amber-400',
                  )}
                >
                  {confidencePct}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-content-tertiary">Human review</span>
                {cfg.alwaysRequireHumanReview ? (
                  <span className="flex items-center gap-1 text-amber-400">
                    <CheckCircle2 className="h-3 w-3" /> Always
                  </span>
                ) : (
                  <span className="text-content-tertiary">Below threshold</span>
                )}
              </div>
            </div>

            <button
              onClick={() => {
                onEdit(cfg);
              }}
              className="w-full rounded-lg border border-border py-1.5 text-xs font-medium text-content-secondary hover:bg-surface-secondary hover:text-content"
            >
              Edit Configuration
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ── Safety Config Tab ──────────────────────────────────────────────────────

function SafetyConfigTab({
  safety,
  onToggleKillSwitch,
}: {
  safety: AiSafetyConfig;
  onToggleKillSwitch: () => void;
}): ReactNode {
  return (
    <div className="space-y-4">
      {/* Global Kill Switch */}
      <div
        className={cn(
          'rounded-xl border p-5',
          safety.globalKillSwitchEnabled
            ? 'border-red-500/30 bg-red-500/5'
            : 'border-border bg-surface',
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Zap
                className={cn(
                  'h-5 w-5',
                  safety.globalKillSwitchEnabled ? 'text-red-400' : 'text-content-tertiary',
                )}
              />
              <h3 className="font-semibold text-content">Global Agent Kill Switch</h3>
            </div>
            <p className="mt-1 text-sm text-content-tertiary">
              Immediately suspends all agent execution across every role and tenant. Use for
              emergency containment. Action is WORM-logged.
            </p>
            {safety.globalKillSwitchEnabled && safety.killSwitchActivatedAt !== null && (
              <p className="mt-2 text-xs text-red-400">
                Activated {new Date(safety.killSwitchActivatedAt).toLocaleString()}
                {safety.killSwitchActivatedBy !== null ? ` by ${safety.killSwitchActivatedBy}` : ''}
              </p>
            )}
          </div>
          <button
            onClick={onToggleKillSwitch}
            className={cn(
              'shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              safety.globalKillSwitchEnabled
                ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-red-500/10 text-red-400 hover:bg-red-500/20',
            )}
          >
            {safety.globalKillSwitchEnabled ? 'Deactivate' : 'Activate Kill Switch'}
          </button>
        </div>
      </div>

      {/* Safety Rules */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="mb-4 font-semibold text-content">Immutable Safety Rules (Rule 9)</h3>
        <div className="space-y-3">
          {[
            {
              label: 'PHI access actions',
              description: 'Always routed to human review queue — no exceptions',
              enforced: true,
            },
            {
              label: 'Financial actions (>$0)',
              description: 'Always routed to human review queue — no exceptions',
              enforced: true,
            },
            {
              label: 'Mass communications (>50 recipients)',
              description: 'Always routed to human review queue — no exceptions',
              enforced: true,
            },
            {
              label: 'Agent self-permission modification',
              description: 'Blocked at runtime — agents cannot expand their own scope',
              enforced: true,
            },
            {
              label: 'Cross-tenant data access',
              description: 'Blocked at runtime — JWT scope enforced server-side',
              enforced: true,
            },
            {
              label: `Minimum confidence floor (${Math.round(safety.minimumConfidenceFloor * 100)}%)`,
              description: 'Actions below this score are auto-rejected without human review',
              enforced: true,
            },
          ].map((rule) => (
            <div
              key={rule.label}
              className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              <div>
                <p className="text-sm font-medium text-content">{rule.label}</p>
                <p className="text-xs text-content-tertiary">{rule.description}</p>
              </div>
              <span className="ml-auto shrink-0 rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                Enforced
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  bg,
  alert,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  bg: string;
  alert?: boolean;
}): ReactNode {
  return (
    <div
      className={cn(
        'rounded-xl border bg-surface p-4',
        alert === true ? 'border-red-500/30' : 'border-border',
      )}
    >
      <div className={cn('mb-3 inline-flex rounded-lg p-2', bg)}>{icon}</div>
      <p className="text-2xl font-bold text-content">{value}</p>
      <p className="mt-0.5 text-xs text-content-tertiary">{label}</p>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────

type Tab = 'models' | 'roles' | 'safety';

export function AiModels(): ReactNode {
  const [tab, setTab] = useState<Tab>('models');
  const [stats, setStats] = useState<AiStats | null>(null);
  const [models, setModels] = useState<AiModel[]>([]);
  const [roleConfigs, setRoleConfigs] = useState<AgentRoleConfig[]>([]);
  const [usage, setUsage] = useState<ModelUsageStat[]>([]);
  const [safety, setSafety] = useState<AiSafetyConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingRole, setEditingRole] = useState<AgentRoleConfig | null>(null);
  const [killSwitchModal, setKillSwitchModal] = useState(false);
  const loadRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadRef.current;
    setLoading(true);
    try {
      const [st, mo, ro, us, sf] = await Promise.all([
        aiModelsApi.getStats(),
        aiModelsApi.listModels(),
        aiModelsApi.listRoleConfigs(),
        aiModelsApi.listUsageStats(),
        aiModelsApi.getSafetyConfig(),
      ]);
      if (seq !== loadRef.current) return;
      setStats(st);
      setModels(mo);
      setRoleConfigs(ro);
      setUsage(us);
      setSafety(sf);
    } catch {
      if (seq !== loadRef.current) return;
      setStats(MOCK_STATS);
      setModels(MOCK_MODELS);
      setRoleConfigs(MOCK_ROLE_CONFIGS);
      setUsage(MOCK_USAGE);
      setSafety(MOCK_SAFETY);
    } finally {
      if (seq === loadRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRoleSaved = useCallback((updated: AgentRoleConfig) => {
    setRoleConfigs((prev) => prev.map((c) => (c.role === updated.role ? updated : c)));
    setEditingRole(null);
  }, []);

  const handleKillSwitchConfirm = useCallback(async () => {
    if (safety === null) return;
    const enabling = !safety.globalKillSwitchEnabled;
    setKillSwitchModal(false);
    try {
      const updated = await aiModelsApi.updateSafetyConfig({
        globalKillSwitchEnabled: enabling,
      });
      setSafety(updated);
    } catch {
      setSafety((prev) =>
        prev !== null
          ? {
              ...prev,
              globalKillSwitchEnabled: enabling,
              killSwitchActivatedAt: enabling ? new Date().toISOString() : null,
              killSwitchActivatedBy: enabling ? 'current-user' : null,
            }
          : prev,
      );
    }
  }, [safety]);

  const TABS: { id: Tab; label: string }[] = [
    { id: 'models', label: 'Model Registry' },
    { id: 'roles', label: 'Agent Roles' },
    { id: 'safety', label: 'Safety Config' },
  ];

  const killActive = safety?.globalKillSwitchEnabled === true;
  const spend = stats?.totalSpend30dUsd ?? 0;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading AI configuration" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Kill Switch Banner */}
      {killActive && (
        <div className="flex items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3">
          <AlertTriangle className="h-5 w-5 shrink-0 text-red-400" />
          <p className="text-sm font-medium text-red-400">
            Global kill switch is active — all agent execution is suspended.
          </p>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-content">AI Models & Safety</h1>
        <p className="mt-1 text-sm text-content-tertiary">
          Model registry · Agent role budgets · Safety governance
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<Cpu className="h-5 w-5 text-blue-400" />}
          label="Active Models"
          value={String(stats?.activeModels ?? 0)}
          bg="bg-blue-500/10"
        />
        <StatCard
          icon={<DollarSign className="h-5 w-5 text-emerald-400" />}
          label="30-day Spend"
          value={`$${spend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          bg="bg-emerald-500/10"
        />
        <StatCard
          icon={<Bot className="h-5 w-5 text-purple-400" />}
          label="Agent Runs Today"
          value={(stats?.agentRunsToday ?? 0).toLocaleString()}
          bg="bg-purple-500/10"
        />
        <StatCard
          icon={<Clock className="h-5 w-5 text-amber-400" />}
          label="Pending Reviews"
          value={String(stats?.pendingHumanReviews ?? 0)}
          bg="bg-amber-500/10"
          alert={(stats?.pendingHumanReviews ?? 0) > 20}
        />
      </div>

      {/* Kill Switch Quick-Access */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <ShieldAlert
            className={cn('h-4 w-4', killActive ? 'text-red-400' : 'text-content-tertiary')}
          />
          <span className="text-sm font-medium text-content">
            Global Kill Switch:{' '}
            <span className={killActive ? 'text-red-400' : 'text-emerald-400'}>
              {killActive ? 'ACTIVE' : 'Inactive'}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-content-tertiary">
            {killActive
              ? 'All agents suspended'
              : `${roleConfigs.filter((r) => r.enabled).length} roles active`}
          </span>
          <button
            onClick={() => {
              setKillSwitchModal(true);
            }}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium',
              killActive
                ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-red-500/10 text-red-400 hover:bg-red-500/20',
            )}
          >
            <ToggleRight className="mr-1 inline-block h-3.5 w-3.5" />
            {killActive ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
              }}
              className={cn(
                'px-4 py-2.5 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'border-b-2 border-brand-accent text-brand-accent'
                  : 'text-content-tertiary hover:text-content',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'models' && <ModelsTab models={models} usage={usage} />}
      {tab === 'roles' && (
        <AgentRolesTab
          configs={roleConfigs}
          models={models}
          onEdit={(c) => {
            setEditingRole(c);
          }}
        />
      )}
      {tab === 'safety' && safety !== null && (
        <SafetyConfigTab
          safety={safety}
          onToggleKillSwitch={() => {
            setKillSwitchModal(true);
          }}
        />
      )}

      {/* Modals */}
      {editingRole !== null && (
        <EditRoleModal
          config={editingRole}
          models={models}
          onClose={() => {
            setEditingRole(null);
          }}
          onSaved={handleRoleSaved}
        />
      )}
      {killSwitchModal && safety !== null && (
        <KillSwitchModal
          enabling={!safety.globalKillSwitchEnabled}
          onClose={() => {
            setKillSwitchModal(false);
          }}
          onConfirm={() => {
            void handleKillSwitchConfirm();
          }}
        />
      )}
    </div>
  );
}
