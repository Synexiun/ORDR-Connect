# ============================================================================
# WAF Module — Outputs
# ============================================================================

output "web_acl_arn" {
  description = "WAFv2 WebACL ARN — attach via Ingress annotation or aws_wafv2_web_acl_association"
  value       = aws_wafv2_web_acl.main.arn
}

output "web_acl_id" {
  description = "WAFv2 WebACL ID"
  value       = aws_wafv2_web_acl.main.id
}

output "web_acl_name" {
  description = "WAFv2 WebACL name"
  value       = aws_wafv2_web_acl.main.name
}

output "log_group_name" {
  description = "CloudWatch log group receiving WAF blocked-request logs"
  value       = aws_cloudwatch_log_group.waf.name
}

output "log_group_arn" {
  description = "CloudWatch log group ARN for WAF logs"
  value       = aws_cloudwatch_log_group.waf.arn
}

output "kms_key_arn" {
  description = "KMS key ARN encrypting WAF log streams"
  value       = aws_kms_key.waf_logs.arn
}
