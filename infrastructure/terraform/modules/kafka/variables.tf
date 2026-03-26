# ============================================================================
# Kafka (MSK) Module — Variables
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
  description = "Private subnet IDs for MSK broker placement"
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 3
    error_message = "At least 3 subnets required for MSK."
  }
}

variable "kafka_sg_id" {
  description = "Kafka security group ID"
  type        = string
}

variable "broker_instance_type" {
  description = "MSK broker instance type"
  type        = string
  default     = "kafka.m5.large"
}

variable "broker_count" {
  description = "Number of Kafka broker nodes"
  type        = number
  default     = 3

  validation {
    condition     = var.broker_count >= 3
    error_message = "Minimum 3 brokers for fault tolerance."
  }
}
