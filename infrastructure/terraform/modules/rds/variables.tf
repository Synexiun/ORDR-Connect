# ============================================================================
# RDS Module — Variables
# ============================================================================

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for RDS placement"
  type        = list(string)
}

variable "database_sg_id" {
  description = "Database security group ID"
  type        = string
}

variable "instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.r6g.xlarge"
}

variable "db_name" {
  description = "Database name"
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9_]{0,62}$", var.db_name))
    error_message = "Database name must be lowercase alphanumeric with underscores."
  }
}

variable "master_username" {
  description = "Master username for RDS"
  type        = string
  sensitive   = true
}

variable "backup_retention_period" {
  description = "Backup retention period in days"
  type        = number
  default     = 35

  validation {
    condition     = var.backup_retention_period >= 35
    error_message = "Backup retention must be at least 35 days for compliance."
  }
}
