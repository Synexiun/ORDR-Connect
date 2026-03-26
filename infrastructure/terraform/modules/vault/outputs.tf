# ============================================================================
# Vault Module — Outputs
# ============================================================================

output "kms_key_arn" {
  description = "KMS key ARN for Vault auto-unseal"
  value       = aws_kms_key.vault.arn
}

output "kms_key_id" {
  description = "KMS key ID for Vault auto-unseal"
  value       = aws_kms_key.vault.id
}

output "namespace" {
  description = "Kubernetes namespace where Vault is deployed"
  value       = kubernetes_namespace.vault.metadata[0].name
}

output "audit_log_group_arn" {
  description = "CloudWatch log group ARN for Vault audit logs"
  value       = aws_cloudwatch_log_group.vault_audit.arn
}
