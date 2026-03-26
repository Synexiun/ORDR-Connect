# ============================================================================
# EKS Module — Variables
# ============================================================================

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "cluster_version" {
  description = "Kubernetes version for EKS cluster"
  type        = string
  default     = "1.29"

  validation {
    condition     = can(regex("^1\\.(2[9-9]|[3-9][0-9])$", var.cluster_version))
    error_message = "Cluster version must be 1.29 or higher."
  }
}

variable "vpc_id" {
  description = "VPC ID for the EKS cluster"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for node groups"
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "At least 2 private subnets required for EKS."
  }
}

variable "api_security_group_id" {
  description = "API security group ID for cluster networking"
  type        = string
}
