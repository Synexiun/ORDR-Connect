# ============================================================================
# Networking Module — Variables
# ============================================================================

variable "environment" {
  description = "Deployment environment"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC"
  type        = string

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "Must be a valid CIDR block."
  }
}

variable "availability_zones" {
  description = "List of availability zones (minimum 3)"
  type        = list(string)

  validation {
    condition     = length(var.availability_zones) >= 3
    error_message = "At least 3 availability zones required for HA."
  }
}
