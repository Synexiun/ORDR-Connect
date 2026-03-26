# ============================================================================
# Backup Module — Variables
# ============================================================================

variable "environment" {
  description = "Deployment environment (staging, production)"
  type        = string
}

variable "rds_instance_arn" {
  description = "ARN of the source RDS instance for backup replication"
  type        = string
}

variable "rds_instance_id" {
  description = "Identifier of the RDS instance for event subscriptions"
  type        = string
}

variable "primary_kms_key_arn" {
  description = "KMS key ARN from the primary region (for SNS encryption)"
  type        = string
}

variable "backup_retention_days" {
  description = "Number of days to retain cross-region backup replicas"
  type        = number
  default     = 35

  validation {
    condition     = var.backup_retention_days >= 35
    error_message = "Backup retention must be at least 35 days for SOC2/HIPAA compliance."
  }
}

variable "dr_region" {
  description = "AWS region for disaster recovery backup replication"
  type        = string
  default     = "us-west-2"
}
