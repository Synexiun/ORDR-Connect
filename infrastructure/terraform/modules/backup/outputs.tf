# ============================================================================
# Backup Module — Outputs
# ============================================================================

output "dr_kms_key_arn" {
  description = "KMS key ARN used for DR-region backup encryption"
  value       = aws_kms_key.backup.arn
}

output "backup_replication_arn" {
  description = "ARN of the cross-region backup replication resource"
  value       = aws_db_instance_automated_backups_replication.cross_region.id
}

output "backup_sns_topic_arn" {
  description = "SNS topic ARN for backup event notifications"
  value       = aws_sns_topic.backup_events.arn
}

output "backup_retention_days" {
  description = "Configured backup retention period in days"
  value       = var.backup_retention_days
}
