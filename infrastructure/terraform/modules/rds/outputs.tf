# ============================================================================
# RDS Module — Outputs
# ============================================================================

output "endpoint" {
  description = "RDS primary endpoint"
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}

output "reader_endpoint" {
  description = "RDS reader endpoint"
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}

output "instance_id" {
  description = "RDS instance identifier"
  value       = aws_db_instance.main.id
}

output "db_name" {
  description = "Database name"
  value       = aws_db_instance.main.db_name
}

output "kms_key_arn" {
  description = "KMS key ARN used for RDS encryption"
  value       = aws_kms_key.rds.arn
}

output "secret_arn" {
  description = "Secrets Manager ARN for RDS master password"
  value       = aws_secretsmanager_secret.rds_master_password.arn
}

output "port" {
  description = "RDS port"
  value       = aws_db_instance.main.port
}
