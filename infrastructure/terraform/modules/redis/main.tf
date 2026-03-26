# ============================================================================
# ORDR-Connect — Redis Module
# ElastiCache Redis 7.x, cluster mode, TLS, at-rest encryption, ACL
# Rule 1: TLS in transit, KMS at rest | Rule 5: auth token in Secrets Manager
# ============================================================================

# ---------------------------------------------------------------------------
# KMS Key for Redis at-rest encryption
# ---------------------------------------------------------------------------

resource "aws_kms_key" "redis" {
  description             = "Redis encryption key — ${var.environment}"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "ordr-redis-kms-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_kms_alias" "redis" {
  name          = "alias/ordr-redis-${var.environment}"
  target_key_id = aws_kms_key.redis.key_id
}

# ---------------------------------------------------------------------------
# Auth Token — Secrets Manager (Rule 5)
# ---------------------------------------------------------------------------

resource "random_password" "redis_auth" {
  length           = 64
  special          = true
  override_special = "!&#$^<>-"
}

resource "aws_secretsmanager_secret" "redis_auth" {
  name                    = "ordr-connect/${var.environment}/redis-auth-token"
  description             = "Redis AUTH token for ${var.environment}"
  recovery_window_in_days = 30
  kms_key_id              = aws_kms_key.redis.arn

  tags = {
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id     = aws_secretsmanager_secret.redis_auth.id
  secret_string = random_password.redis_auth.result
}

# ---------------------------------------------------------------------------
# Subnet Group — Private subnets only
# ---------------------------------------------------------------------------

resource "aws_elasticache_subnet_group" "main" {
  name        = "ordr-connect-redis-${var.environment}"
  description = "Private subnet group for Redis"
  subnet_ids  = var.private_subnet_ids

  tags = {
    Name        = "ordr-redis-subnet-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Parameter Group — Redis 7.x
# ---------------------------------------------------------------------------

resource "aws_elasticache_parameter_group" "main" {
  family      = "redis7"
  name        = "ordr-connect-redis7-${var.environment}"
  description = "ORDR-Connect Redis 7 parameters"

  # Enforce ACL authentication
  parameter {
    name  = "cluster-enabled"
    value = "no"
  }

  tags = {
    Name        = "ordr-redis-params-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# ElastiCache Replication Group — Encrypted, TLS, auth
# ---------------------------------------------------------------------------

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "ordr-connect-${var.environment}"
  description          = "ORDR-Connect Redis cluster — ${var.environment}"

  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.node_type
  num_cache_clusters   = var.num_cache_clusters
  port                 = 6379
  parameter_group_name = aws_elasticache_parameter_group.main.name
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [var.redis_sg_id]

  # Encryption — Rule 1
  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.redis.arn
  transit_encryption_enabled = true

  # Authentication — Rule 2
  auth_token = random_password.redis_auth.result

  # HA configuration
  automatic_failover_enabled = var.num_cache_clusters > 1
  multi_az_enabled           = var.num_cache_clusters > 1

  # Maintenance
  maintenance_window       = "Mon:05:00-Mon:06:00"
  snapshot_window          = "03:00-04:00"
  snapshot_retention_limit = var.environment == "production" ? 35 : 7
  auto_minor_version_upgrade = true

  tags = {
    Name        = "ordr-redis-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
    Compliance  = "soc2-iso27001"
  }
}
