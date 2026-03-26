# ============================================================================
# S3 Module — Variables
# ============================================================================

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "audit_retention_days" {
  description = "Audit log retention in days (WORM Object Lock compliance mode)"
  type        = number
  default     = 2557

  validation {
    condition     = var.audit_retention_days >= 2557
    error_message = "Audit retention must be at least 2557 days (7 years) per HIPAA."
  }
}

variable "backup_region" {
  description = "AWS region for cross-region backup replication"
  type        = string
  default     = "us-west-2"
}
