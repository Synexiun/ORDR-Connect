/**
 * @ordr/agent-runtime — AI agent execution environment for ORDR-Connect
 *
 * Compliance-first (SOC2/ISO27001/HIPAA) multi-agent runtime implementing:
 * - Stateful agent loop: Observe -> Think -> Act -> Check -> Repeat
 * - Supervisor-pattern orchestration across specialized agents
 * - 3-tier memory: Working -> Episodic -> Semantic
 * - Inter-agent communication via message bus
 * - Session checkpointing for crash recovery
 *
 * SECURITY: Every action is gated by compliance checks and audit-logged.
 * Agents operate under strict budget, confidence, and permission constraints.
 */

// ─── Types ──────────────────────────────────────────────────────
export type {
  AgentTool,
  AgentBudget,
  KillSwitch,
  AgentContext,
  AgentMemoryState,
  AgentStep,
  AgentDecision,
  AgentOutcome,
  HitlItem,
  LLMParsedResponse,
  AgentEngineDeps,
  StepType,
  SessionResult,
} from './types.js';

export { CONFIDENCE_THRESHOLD, DEFAULT_MAX_STEPS, STEP_TYPES, SESSION_RESULTS } from './types.js';

// ─── Engine ─────────────────────────────────────────────────────
export { AgentEngine } from './engine.js';

// ─── Memory ─────────────────────────────────────────────────────
export { AgentMemory } from './memory.js';

// ─── HITL Queue ─────────────────────────────────────────────────
export { HitlQueue } from './hitl.js';

// ─── Prompts ────────────────────────────────────────────────────
export {
  buildCollectionsPrompt,
  buildGenericPrompt,
  buildLeadQualifierPrompt,
  buildMeetingPrepPrompt,
  buildChurnDetectionPrompt,
  buildExecutiveBriefingPrompt,
} from './prompts.js';

// ─── Orchestrator ───────────────────────────────────────────────
export { AgentOrchestrator, MAX_HANDOFF_DEPTH } from './orchestrator.js';
export type { OrchestratorDeps, HandoffContext, NBAPipelineInterface } from './orchestrator.js';

// ─── Agent Registry ─────────────────────────────────────────────
export { AgentRegistry } from './agent-registry.js';
export type { AgentConfig, PromptBuilder } from './agent-registry.js';

// ─── Message Protocol ───────────────────────────────────────────
export { MessageBus, MESSAGE_TYPES } from './message-protocol.js';
export type { AgentMessage, MessageType } from './message-protocol.js';

// ─── Memory Manager ────────────────────────────────────────────
export { MemoryManager, InMemoryEpisodicStore } from './memory/manager.js';
export type { EpisodicMemory, SemanticMatch, EpisodicStore } from './memory/manager.js';

// ─── Checkpoint ─────────────────────────────────────────────────
export {
  CheckpointManager,
  InMemoryCheckpointStore,
  CHECKPOINT_AUTO_SAVE_INTERVAL,
} from './checkpoint.js';
export type { CheckpointInfo, CheckpointStore } from './checkpoint.js';

// ─── Agent Prompt Builders ──────────────────────────────────────
export { buildSupportTriagePrompt } from './agents/support-triage.js';
export { buildEscalationPrompt } from './agents/escalation.js';

// ─── Tools (Original) ──────────────────────────────────────────
export { createToolRegistry } from './tools/index.js';
export type { ToolRegistryDeps } from './tools/index.js';

export { createSendSmsTool } from './tools/send-sms.js';
export type { SendSmsDeps } from './tools/send-sms.js';

export { createLookupCustomerTool } from './tools/lookup-customer.js';
export type {
  LookupCustomerDeps,
  CustomerInfo,
  CustomerInteraction,
} from './tools/lookup-customer.js';

export { createCheckPaymentTool } from './tools/check-payment.js';
export type { CheckPaymentDeps, PaymentInfo } from './tools/check-payment.js';

export { createScheduleFollowupTool } from './tools/schedule-followup.js';
export type { ScheduleFollowupDeps } from './tools/schedule-followup.js';

// ─── Tools (New — Support + Escalation) ─────────────────────────
export { createSearchKnowledgeTool } from './tools/search-knowledge.js';
export type { SearchKnowledgeDeps, KnowledgeArticle } from './tools/search-knowledge.js';

export {
  createCategorizeTicketTool,
  TICKET_CATEGORIES,
  TICKET_SUBCATEGORIES,
  TICKET_PRIORITIES,
} from './tools/categorize-ticket.js';
export type {
  CategorizeTicketDeps,
  CategorizeResult,
  TicketCategory,
  TicketPriority,
} from './tools/categorize-ticket.js';

export { createRouteTicketTool } from './tools/route-ticket.js';
export type { RouteTicketDeps, RouteResult } from './tools/route-ticket.js';

export { createEscalateTool } from './tools/escalate.js';
export type { EscalateDeps, EscalationResult } from './tools/escalate.js';

export { createSummarizeConversationTool } from './tools/summarize-conversation.js';
export type {
  SummarizeConversationDeps,
  ConversationSummary,
} from './tools/summarize-conversation.js';
