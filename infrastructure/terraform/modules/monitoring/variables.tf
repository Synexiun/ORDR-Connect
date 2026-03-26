# ============================================================================
# Monitoring Module — Variables
# ============================================================================

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "eks_cluster_id" {
  description = "EKS cluster ID where monitoring stack is deployed"
  type        = string
}
