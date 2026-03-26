/**
 * AgentFlowGraph — Agent orchestration flow visualization.
 *
 * Shows multi-agent session as a vertical flow:
 * - Nodes: agent steps (observe, think, act, check)
 * - Edges: step transitions
 * - Handoff markers between different agent roles
 * - Color coding: green (completed), yellow (in progress), red (failed), blue (HITL pending)
 *
 * COMPLIANCE: No customer data or PHI displayed — only agent step metadata.
 */

import { type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/Badge';

// --- Types ---

type StepPhase = 'observe' | 'think' | 'act' | 'check' | 'handoff';
type StepStatus = 'completed' | 'in-progress' | 'failed' | 'hitl-pending' | 'pending';

export interface FlowStep {
  id: string;
  phase: StepPhase;
  agentRole: string;
  description: string;
  status: StepStatus;
  confidence?: number;
  tool?: string;
  durationMs?: number;
}

interface AgentFlowGraphProps {
  steps: FlowStep[];
  className?: string;
}

// --- Step styling ---

const statusColor: Record<StepStatus, string> = {
  completed: 'border-emerald-500 bg-emerald-500/10',
  'in-progress': 'border-amber-500 bg-amber-500/10',
  failed: 'border-red-500 bg-red-500/10',
  'hitl-pending': 'border-blue-500 bg-blue-500/10',
  pending: 'border-border bg-surface-tertiary/50',
};

const statusBadgeVariant: Record<StepStatus, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  completed: 'success',
  'in-progress': 'warning',
  failed: 'danger',
  'hitl-pending': 'info',
  pending: 'neutral',
};

const statusDotColor: Record<StepStatus, string> = {
  completed: 'bg-emerald-400',
  'in-progress': 'bg-amber-400',
  failed: 'bg-red-400',
  'hitl-pending': 'bg-blue-400',
  pending: 'bg-slate-500',
};

const phaseIcon: Record<StepPhase, string> = {
  observe: '\u25C9', // eye
  think: '\u25C7',   // diamond outline
  act: '\u25B6',     // play
  check: '\u2713',   // check
  handoff: '\u21C4', // arrows
};

// --- Component ---

export function AgentFlowGraph({ steps, className }: AgentFlowGraphProps): ReactNode {
  if (steps.length === 0) {
    return (
      <div className={cn('flex items-center justify-center py-8 text-sm text-content-secondary', className)}>
        No flow steps available
      </div>
    );
  }

  return (
    <div className={cn('relative', className)} role="list" aria-label="Agent execution flow">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const prevStep: FlowStep | undefined = index > 0 ? steps[index - 1] : undefined;
        const isHandoff = prevStep !== undefined && prevStep.agentRole !== step.agentRole;

        return (
          <div key={step.id} role="listitem">
            {/* Handoff marker */}
            {isHandoff && (
              <div className="relative flex items-center py-2 pl-5">
                <div className="absolute left-[19px] top-0 h-full w-px bg-border" />
                <div className="relative z-10 flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1">
                  <span className="text-xs text-blue-400" aria-hidden="true">{'\u21C4'}</span>
                  <span className="text-2xs font-medium text-blue-400">
                    Handoff: {prevStep ? prevStep.agentRole : 'unknown'} {'\u2192'} {step.agentRole}
                  </span>
                </div>
              </div>
            )}

            <div className="relative flex gap-3 pb-4 pl-5">
              {/* Vertical connector line */}
              {!isLast && (
                <div
                  className="absolute left-[19px] top-8 bottom-0 w-px bg-border"
                  aria-hidden="true"
                />
              )}

              {/* Status dot */}
              <div className="relative z-10 mt-1.5 flex-shrink-0">
                <div
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full border-2',
                    statusColor[step.status],
                  )}
                >
                  <div className={cn('h-2 w-2 rounded-full', statusDotColor[step.status])} />
                </div>
              </div>

              {/* Step content */}
              <div
                className={cn(
                  'flex-1 rounded-lg border p-3',
                  statusColor[step.status],
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-content-secondary" aria-hidden="true">
                      {phaseIcon[step.phase]}
                    </span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
                      {step.phase}
                    </span>
                    <Badge variant={statusBadgeVariant[step.status]} size="sm" dot>
                      {step.status}
                    </Badge>
                  </div>
                  <span className="text-2xs text-content-tertiary capitalize">
                    {step.agentRole}
                  </span>
                </div>

                <p className="mt-1.5 text-sm text-content">{step.description}</p>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-content-tertiary">
                  {step.tool && (
                    <span>
                      Tool: <span className="font-mono text-content-secondary">{step.tool}</span>
                    </span>
                  )}
                  {step.confidence !== undefined && (
                    <span>
                      Confidence:{' '}
                      <span
                        className={cn(
                          'font-mono',
                          step.confidence >= 0.8 ? 'text-emerald-400' :
                          step.confidence >= 0.7 ? 'text-amber-400' : 'text-red-400',
                        )}
                      >
                        {(step.confidence * 100).toFixed(0)}%
                      </span>
                    </span>
                  )}
                  {step.durationMs !== undefined && (
                    <span>
                      Duration: <span className="font-mono text-content-secondary">{step.durationMs}ms</span>
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
