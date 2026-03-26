# ============================================================================
# Vault Module — Variables
# ============================================================================

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "eks_cluster_id" {
  description = "EKS cluster ID for Vault deployment"
  type        = string
}

variable "vault_replicas" {
  description = "Number of Vault server replicas for HA"
  type        = number
  default     = 3

  validation {
    condition     = var.vault_replicas >= 3
    error_message = "Minimum 3 replicas for Vault HA."
  }
}
