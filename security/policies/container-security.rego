# Container Security Policy — ORDR-Connect
#
# SOC2 CC6.6 — System boundaries: container hardening.
# ISO 27001 A.12.6.1 — Management of technical vulnerabilities.
# CIS Docker Benchmark compliance.
#
# Non-root enforcement, read-only filesystem, no privilege escalation,
# resource limits required.

package ordr.container_security

import future.keywords.in

default allow := false

# ── Allow: Container meeting all security requirements ────────────────

allow {
    not runs_as_root
    no_privilege_escalation
    resource_limits_set
    not uses_latest_tag
    not has_critical_cves
}

# ── Deny: Container running as root ──────────────────────────────────

runs_as_root {
    input.container.user == "root"
}

runs_as_root {
    input.container.user == "0"
}

runs_as_root {
    not input.container.user
}

deny[msg] {
    runs_as_root
    msg := "Container must not run as root — use a non-root user (CLAUDE.md Rule 8)"
}

# ── Deny: Privilege escalation allowed ────────────────────────────────

no_privilege_escalation {
    input.container.security_context.allow_privilege_escalation == false
}

deny[msg] {
    not no_privilege_escalation
    msg := "Container must not allow privilege escalation — set allowPrivilegeEscalation: false"
}

# ── Deny: Privileged container ────────────────────────────────────────

deny[msg] {
    input.container.security_context.privileged == true
    msg := "Privileged containers are forbidden"
}

# ── Read-only filesystem recommendation ───────────────────────────────

deny[msg] {
    not input.container.security_context.read_only_root_filesystem == true
    input.container.requires_writable_fs != true
    msg := "Container should use read-only root filesystem where possible — set readOnlyRootFilesystem: true"
}

# ── Resource limits ───────────────────────────────────────────────────

resource_limits_set {
    input.container.resources.limits.cpu
    input.container.resources.limits.memory
    input.container.resources.requests.cpu
    input.container.resources.requests.memory
}

deny[msg] {
    not input.container.resources.limits.cpu
    msg := "Container CPU limit is required"
}

deny[msg] {
    not input.container.resources.limits.memory
    msg := "Container memory limit is required"
}

deny[msg] {
    not input.container.resources.requests.cpu
    msg := "Container CPU request is required"
}

deny[msg] {
    not input.container.resources.requests.memory
    msg := "Container memory request is required"
}

# ── Deny: :latest tag in production ───────────────────────────────────

uses_latest_tag {
    endswith(input.container.image, ":latest")
}

uses_latest_tag {
    not contains(input.container.image, ":")
}

deny[msg] {
    uses_latest_tag
    msg := sprintf("Image '%s' uses :latest tag or no tag — pinned versions required in production", [input.container.image])
}

# ── Deny: Critical CVEs ──────────────────────────────────────────────

has_critical_cves {
    input.container.scan_results.critical_count > 0
}

has_critical_cves {
    input.container.scan_results.high_count > 0
}

deny[msg] {
    input.container.scan_results.critical_count > 0
    msg := sprintf("Container image has %d critical CVEs — must be patched within 48 hours", [input.container.scan_results.critical_count])
}

deny[msg] {
    input.container.scan_results.high_count > 0
    msg := sprintf("Container image has %d high CVEs — must be patched within 48 hours", [input.container.scan_results.high_count])
}

# ── Deny: Non-distroless/Alpine base image ───────────────────────────

deny[msg] {
    not startswith(input.container.base_image, "gcr.io/distroless/")
    not contains(input.container.base_image, "alpine")
    not contains(input.container.base_image, "chainguard")
    msg := sprintf("Base image '%s' is not distroless or Alpine — use distroless or Alpine base images", [input.container.base_image])
}

# ── Deny: Capabilities not dropped ───────────────────────────────────

deny[msg] {
    not input.container.security_context.capabilities.drop
    msg := "Container must drop all capabilities — set capabilities.drop: ['ALL']"
}

deny[msg] {
    input.container.security_context.capabilities.drop
    not "ALL" in input.container.security_context.capabilities.drop
    msg := "Container must drop ALL capabilities — add 'ALL' to capabilities.drop"
}
