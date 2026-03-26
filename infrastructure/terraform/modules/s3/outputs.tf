# ============================================================================
# S3 Module — Outputs
# ============================================================================

output "audit_bucket_arn" {
  description = "Audit log bucket ARN (WORM, Object Lock)"
  value       = aws_s3_bucket.audit.arn
}

output "audit_bucket_id" {
  description = "Audit log bucket name"
  value       = aws_s3_bucket.audit.id
}

output "sbom_bucket_arn" {
  description = "SBOM artifact bucket ARN"
  value       = aws_s3_bucket.sbom.arn
}

output "sbom_bucket_id" {
  description = "SBOM artifact bucket name"
  value       = aws_s3_bucket.sbom.id
}

output "backup_bucket_arn" {
  description = "Backup bucket ARN"
  value       = aws_s3_bucket.backup.arn
}

output "backup_bucket_id" {
  description = "Backup bucket name"
  value       = aws_s3_bucket.backup.id
}

output "kms_key_arn" {
  description = "KMS key ARN for S3 encryption"
  value       = aws_kms_key.s3.arn
}
