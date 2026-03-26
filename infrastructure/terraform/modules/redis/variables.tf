# ============================================================================
# Redis Module — Variables
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
  description = "Private subnet IDs for Redis placement"
  type        = list(string)
}

variable "redis_sg_id" {
  description = "Redis security group ID"
  type        = string
}

variable "node_type" {
  description = "ElastiCache node type"
  type        = string
  default     = "cache.r6g.large"
}

variable "num_cache_clusters" {
  description = "Number of cache clusters (primary + replicas)"
  type        = number
  default     = 3

  validation {
    condition     = var.num_cache_clusters >= 2
    error_message = "At least 2 cache clusters required for HA."
  }
}
