# ============================================================================
# ORDR-Connect — Root Outputs
# ============================================================================

# ---------------------------------------------------------------------------
# Networking
# ---------------------------------------------------------------------------

output "vpc_id" {
  description = "VPC ID"
  value       = module.networking.vpc_id
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = module.networking.private_subnet_ids
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = module.networking.public_subnet_ids
}

# ---------------------------------------------------------------------------
# EKS
# ---------------------------------------------------------------------------

output "eks_cluster_name" {
  description = "EKS cluster name"
  value       = module.eks.cluster_name
}

output "eks_cluster_endpoint" {
  description = "EKS cluster API endpoint"
  value       = module.eks.cluster_endpoint
  sensitive   = true
}

output "eks_oidc_provider_arn" {
  description = "EKS OIDC provider ARN for IRSA"
  value       = module.eks.oidc_provider_arn
}

# ---------------------------------------------------------------------------
# RDS
# ---------------------------------------------------------------------------

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint"
  value       = module.rds.endpoint
  sensitive   = true
}

output "rds_reader_endpoint" {
  description = "RDS reader endpoint"
  value       = module.rds.reader_endpoint
  sensitive   = true
}

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------

output "redis_primary_endpoint" {
  description = "Redis primary endpoint"
  value       = module.redis.primary_endpoint
  sensitive   = true
}

# ---------------------------------------------------------------------------
# Kafka
# ---------------------------------------------------------------------------

output "kafka_bootstrap_brokers_tls" {
  description = "Kafka TLS bootstrap broker connection string"
  value       = module.kafka.bootstrap_brokers_tls
  sensitive   = true
}

output "kafka_bootstrap_brokers_sasl" {
  description = "Kafka SASL/SCRAM bootstrap broker connection string"
  value       = module.kafka.bootstrap_brokers_sasl_scram
  sensitive   = true
}

# ---------------------------------------------------------------------------
# S3
# ---------------------------------------------------------------------------

output "audit_bucket_arn" {
  description = "Audit log S3 bucket ARN"
  value       = module.s3.audit_bucket_arn
}

output "backup_bucket_arn" {
  description = "Backup S3 bucket ARN"
  value       = module.s3.backup_bucket_arn
}

output "sbom_bucket_arn" {
  description = "SBOM artifact S3 bucket ARN"
  value       = module.s3.sbom_bucket_arn
}
