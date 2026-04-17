# ============================================================================
# ORDR-Connect — Root Variables
# ============================================================================

variable "environment" {
  description = "Deployment environment (staging, production)"
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Environment must be 'staging' or 'production'."
  }
}

variable "aws_region" {
  description = "Primary AWS region for deployment"
  type        = string
  default     = "us-east-1"

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]$", var.aws_region))
    error_message = "Must be a valid AWS region identifier."
  }
}

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string
  default     = "10.0.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "Must be a valid CIDR block."
  }
}

# ---------------------------------------------------------------------------
# EKS
# ---------------------------------------------------------------------------

variable "eks_cluster_version" {
  description = "Kubernetes version for EKS cluster"
  type        = string
  default     = "1.29"

  validation {
    condition     = can(regex("^1\\.(2[9-9]|[3-9][0-9])$", var.eks_cluster_version))
    error_message = "EKS cluster version must be 1.29 or higher."
  }
}

# ---------------------------------------------------------------------------
# RDS
# ---------------------------------------------------------------------------

variable "rds_instance_class" {
  description = "RDS instance class for PostgreSQL"
  type        = string
  default     = "db.r6g.xlarge"
}

variable "db_name" {
  description = "Name of the PostgreSQL database"
  type        = string
  default     = "ordr_connect"

  validation {
    condition     = can(regex("^[a-z][a-z0-9_]{0,62}$", var.db_name))
    error_message = "Database name must start with a letter and contain only lowercase alphanumeric and underscores."
  }
}

variable "db_master_username" {
  description = "Master username for RDS (actual password in Secrets Manager)"
  type        = string
  default     = "ordr_admin"
  sensitive   = true
}

variable "db_backup_retention_days" {
  description = "Number of days to retain RDS automated backups"
  type        = number
  default     = 35

  validation {
    condition     = var.db_backup_retention_days >= 35
    error_message = "Backup retention must be at least 35 days for compliance."
  }
}

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------

variable "redis_node_type" {
  description = "ElastiCache Redis node type"
  type        = string
  default     = "cache.r6g.large"
}

variable "redis_num_cache_clusters" {
  description = "Number of Redis cache clusters (replicas + 1 primary)"
  type        = number
  default     = 3

  validation {
    condition     = var.redis_num_cache_clusters >= 2
    error_message = "At least 2 cache clusters required for HA."
  }
}

# ---------------------------------------------------------------------------
# Kafka (MSK)
# ---------------------------------------------------------------------------

variable "kafka_broker_instance_type" {
  description = "MSK broker instance type"
  type        = string
  default     = "kafka.m5.large"
}

variable "kafka_broker_count" {
  description = "Number of Kafka broker nodes (minimum 3)"
  type        = number
  default     = 3

  validation {
    condition     = var.kafka_broker_count >= 3
    error_message = "Minimum 3 Kafka brokers required for fault tolerance."
  }
}

# ---------------------------------------------------------------------------
# S3
# ---------------------------------------------------------------------------

variable "audit_retention_days" {
  description = "Audit log retention in days (7 years = 2557 days)"
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

# ---------------------------------------------------------------------------
# Vault
# ---------------------------------------------------------------------------

variable "vault_replicas" {
  description = "Number of Vault server replicas for HA"
  type        = number
  default     = 3

  validation {
    condition     = var.vault_replicas >= 3
    error_message = "Minimum 3 replicas for Vault HA."
  }
}

# ---------------------------------------------------------------------------
# WAF (AWS WAFv2)
# ---------------------------------------------------------------------------

variable "waf_rate_limit_per_5min" {
  description = "Per-IP request ceiling over a 5-minute sliding window"
  type        = number
  default     = 10000

  validation {
    condition     = var.waf_rate_limit_per_5min >= 100
    error_message = "WAF rate limit must be at least 100."
  }
}

variable "waf_blocked_country_codes" {
  description = "ISO 3166-1 alpha-2 country codes to geo-block (empty disables rule)"
  type        = list(string)
  default     = []
}

variable "waf_log_retention_days" {
  description = "CloudWatch retention for WAF logs (SOC 2 evidence window)"
  type        = number
  default     = 365

  validation {
    condition     = var.waf_log_retention_days >= 90
    error_message = "WAF log retention must be at least 90 days."
  }
}
