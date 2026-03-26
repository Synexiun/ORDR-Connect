# Agent Permissions Policy — ORDR-Connect
#
# CLAUDE.md Rule 9 — Agent Safety & AI Governance.
# SOC2 CC6.3 — Role-based authorization.
# HIPAA §164.312(a)(1) — Access control for automated systems.
#
# Agents cannot modify their own permissions, tool execution is bounded
# by allowlist, and budget enforcement is mandatory.

package ordr.agent_permissions

import future.keywords.in

default allow := false

# ── Allow: Agent action within its allowlisted tools ──────────────────

allow {
    input.agent.role in data.agent_roles
    input.action.tool_name in data.agent_roles[input.agent.role].allowed_tools
    budget_within_limits
    confidence_acceptable
}

# ── Deny: Agent modifying its own permissions ─────────────────────────

deny[msg] {
    input.action.tool_name == "modify_permissions"
    input.action.target_agent_id == input.agent.id
    msg := "Agents cannot modify their own permission boundaries (Rule 9)"
}

deny[msg] {
    input.action.tool_name == "update_role"
    input.action.target_agent_id == input.agent.id
    msg := "Agents cannot update their own role assignment"
}

deny[msg] {
    input.action.tool_name == "grant_tool_access"
    input.action.target_agent_id == input.agent.id
    msg := "Agents cannot grant themselves additional tool access"
}

# ── Deny: Tool not in allowlist ───────────────────────────────────────

deny[msg] {
    not input.action.tool_name in data.agent_roles[input.agent.role].allowed_tools
    msg := sprintf("Agent role '%s' is not authorized to use tool '%s'", [input.agent.role, input.action.tool_name])
}

# ── Budget enforcement ────────────────────────────────────────────────

budget_within_limits {
    input.agent.session.tokens_used <= input.agent.budget.max_tokens
    input.agent.session.actions_count <= input.agent.budget.max_actions
    input.agent.session.cost_usd <= input.agent.budget.max_cost_usd
}

deny[msg] {
    input.agent.session.tokens_used > input.agent.budget.max_tokens
    msg := sprintf("Agent token budget exceeded: %d / %d", [input.agent.session.tokens_used, input.agent.budget.max_tokens])
}

deny[msg] {
    input.agent.session.actions_count > input.agent.budget.max_actions
    msg := sprintf("Agent action budget exceeded: %d / %d", [input.agent.session.actions_count, input.agent.budget.max_actions])
}

deny[msg] {
    input.agent.session.cost_usd > input.agent.budget.max_cost_usd
    msg := sprintf("Agent cost budget exceeded: $%.2f / $%.2f", [input.agent.session.cost_usd, input.agent.budget.max_cost_usd])
}

# ── Confidence threshold ──────────────────────────────────────────────

confidence_acceptable {
    input.action.confidence >= 0.7
}

deny[msg] {
    input.action.confidence < 0.7
    msg := sprintf("Agent action confidence %.2f below threshold 0.70 — requires human review", [input.action.confidence])
}

# ── Human-in-the-loop requirements ────────────────────────────────────

deny[msg] {
    input.action.category == "financial"
    not input.action.human_approved
    msg := "Financial actions require human-in-the-loop approval"
}

deny[msg] {
    input.action.category == "phi_access"
    not input.action.human_approved
    msg := "PHI access actions require human-in-the-loop approval"
}

deny[msg] {
    input.action.category == "mass_communication"
    not input.action.human_approved
    msg := "Mass communication actions require human-in-the-loop approval"
}

# ── Deny: Agent accessing data outside its tenant scope ───────────────

deny[msg] {
    input.action.target_tenant_id != input.agent.tenant_id
    msg := sprintf("Agent cannot access data in tenant '%s' — scoped to '%s'", [input.action.target_tenant_id, input.agent.tenant_id])
}

# ── Kill switch ───────────────────────────────────────────────────────

deny[msg] {
    data.kill_switch.global == true
    msg := "Global agent kill switch is active — all agent actions suspended"
}

deny[msg] {
    data.kill_switch.tenants[input.agent.tenant_id] == true
    msg := sprintf("Tenant-level agent kill switch active for '%s'", [input.agent.tenant_id])
}
