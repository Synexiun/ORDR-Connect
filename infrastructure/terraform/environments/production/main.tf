# ============================================================================
# ORDR-Connect — Production Environment
# Full-size instances, Multi-AZ everything, maximum retention
# ============================================================================

terraform {
  required_version = ">= 1.6.0"

  backend "s3" {
    bucket         = "ordr-connect-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "ordr-connect-terraform-locks"
    kms_key_id     = "alias/ordr-connect-terraform"
  }
}

module "ordr_connect" {
  source = "../../"

  environment = "production"
  aws_region  = "us-east-1"

  # Networking
  vpc_cidr = "10.0.0.0/16"

  # EKS
  eks_cluster_version = "1.29"

  # RDS — full production size, Multi-AZ
  rds_instance_class       = "db.r6g.xlarge"
  db_name                  = "ordr_connect"
  db_master_username       = "ordr_admin"
  db_backup_retention_days = 35

  # Redis — production HA
  redis_node_type          = "cache.r6g.xlarge"
  redis_num_cache_clusters = 3

  # Kafka — production throughput
  kafka_broker_instance_type = "kafka.m5.xlarge"
  kafka_broker_count         = 6

  # S3 — 7-year WORM retention
  audit_retention_days = 2557
  backup_region        = "us-west-2"

  # Vault — full HA
  vault_replicas = 5
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------

output "vpc_id" {
  value = module.ordr_connect.vpc_id
}

output "eks_cluster_name" {
  value = module.ordr_connect.eks_cluster_name
}

output "rds_endpoint" {
  value     = module.ordr_connect.rds_endpoint
  sensitive = true
}

output "redis_endpoint" {
  value     = module.ordr_connect.redis_primary_endpoint
  sensitive = true
}

output "kafka_brokers" {
  value     = module.ordr_connect.kafka_bootstrap_brokers_tls
  sensitive = true
}

output "audit_bucket_arn" {
  value = module.ordr_connect.audit_bucket_arn
}
