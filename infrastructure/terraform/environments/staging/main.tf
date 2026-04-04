# ============================================================================
# ORDR-Connect — Staging Environment
# Smaller instances, lower retention, same security controls
# ============================================================================

terraform {
  required_version = ">= 1.6.0"

  # IMPORTANT: bucket and dynamodb_table are suffixed with the AWS account ID
  # by the bootstrap module (infrastructure/terraform/bootstrap/).
  # Do NOT use these literal values — pass the actual names at init time:
  #   terraform init \
  #     -backend-config="bucket=ordr-connect-tfstate-<ACCOUNT_ID>" \
  #     -backend-config="dynamodb_table=ordr-connect-terraform-locks-<ACCOUNT_ID>"
  backend "s3" {
    bucket         = "ordr-connect-terraform-state"
    key            = "staging/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "ordr-connect-terraform-locks"
    kms_key_id     = "alias/ordr-connect-terraform"
  }
}

module "ordr_connect" {
  source = "../../"

  environment = "staging"
  aws_region  = "us-east-1"

  # Networking
  vpc_cidr = "10.1.0.0/16"

  # EKS
  eks_cluster_version = "1.29"

  # RDS — smaller for staging
  rds_instance_class       = "db.r6g.large"
  db_name                  = "ordr_connect"
  db_master_username       = "ordr_admin"
  db_backup_retention_days = 35

  # Redis — smaller for staging
  redis_node_type          = "cache.r6g.large"
  redis_num_cache_clusters = 2

  # Kafka — minimum viable
  kafka_broker_instance_type = "kafka.m5.large"
  kafka_broker_count         = 3

  # S3 — same retention (compliance requires it)
  audit_retention_days = 2557
  backup_region        = "us-west-2"

  # Vault
  vault_replicas = 3
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
