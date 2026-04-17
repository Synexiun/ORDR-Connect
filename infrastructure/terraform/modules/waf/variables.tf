# ============================================================================
# WAF Module — Variables
# ============================================================================

variable "environment" {
  description = "Deployment environment (staging, production)"
  type        = string

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Environment must be 'staging' or 'production'."
  }
}

variable "rate_limit_per_5min" {
  description = "Per-IP request ceiling over a 5-minute sliding window"
  type        = number
  default     = 10000

  validation {
    # AWS WAFv2 rate-based rule minimum is 100.
    condition     = var.rate_limit_per_5min >= 100
    error_message = "rate_limit_per_5min must be at least 100."
  }
}

variable "blocked_country_codes" {
  description = "ISO 3166-1 alpha-2 country codes to geo-block. Empty disables the rule."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for c in var.blocked_country_codes : can(regex("^[A-Z]{2}$", c))])
    error_message = "Each entry must be an uppercase ISO 3166-1 alpha-2 country code."
  }
}

variable "log_retention_days" {
  description = "CloudWatch log retention for WAF logs"
  type        = number
  default     = 365

  validation {
    condition     = var.log_retention_days >= 90
    error_message = "WAF log retention must be at least 90 days for SOC 2 evidence."
  }
}
