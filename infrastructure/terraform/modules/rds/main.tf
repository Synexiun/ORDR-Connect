# ============================================================================
# ORDR-Connect — RDS Module
# PostgreSQL 16, Multi-AZ, encrypted, private subnet, force SSL
# Rule 1: AES-256 at rest | Rule 10: private subnet only
# ============================================================================

# ---------------------------------------------------------------------------
# KMS Key for RDS encryption at rest
# ---------------------------------------------------------------------------

resource "aws_kms_key" "rds" {
  description             = "RDS encryption key — ${var.environment}"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "ordr-rds-kms-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_kms_alias" "rds" {
  name          = "alias/ordr-rds-${var.environment}"
  target_key_id = aws_kms_key.rds.key_id
}

# ---------------------------------------------------------------------------
# DB Subnet Group — Private subnets only
# ---------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name        = "ordr-connect-${var.environment}"
  description = "Private subnet group for RDS — never public"
  subnet_ids  = var.private_subnet_ids

  tags = {
    Name        = "ordr-rds-subnet-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Parameter Group — Force SSL, enable connection logging
# ---------------------------------------------------------------------------

resource "aws_db_parameter_group" "postgresql" {
  family = "postgres16"
  name   = "ordr-connect-pg16-${var.environment}"

  # Force SSL connections — Rule 1
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # Audit logging — Rule 3
  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  parameter {
    name  = "log_statement"
    value = "ddl"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  # Security hardening
  parameter {
    name  = "password_encryption"
    value = "scram-sha-256"
  }

  tags = {
    Name        = "ordr-pg-params-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Master Password in Secrets Manager — Rule 5
# ---------------------------------------------------------------------------

resource "random_password" "master" {
  length           = 32
  special          = true
  override_special = "!#$%^&*()-_=+"
}

resource "aws_secretsmanager_secret" "rds_master_password" {
  name                    = "ordr-connect/${var.environment}/rds-master-password"
  description             = "RDS master password for ${var.environment}"
  recovery_window_in_days = 30
  kms_key_id              = aws_kms_key.rds.arn

  tags = {
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_secretsmanager_secret_version" "rds_master_password" {
  secret_id     = aws_secretsmanager_secret.rds_master_password.id
  secret_string = random_password.master.result
}

# ---------------------------------------------------------------------------
# RDS Instance — Multi-AZ, encrypted, private
# ---------------------------------------------------------------------------

resource "aws_db_instance" "main" {
  identifier = "ordr-connect-${var.environment}"

  engine         = "postgres"
  engine_version = "16.4"
  instance_class = var.instance_class

  db_name  = var.db_name
  username = var.master_username
  password = random_password.master.result

  # Storage — encrypted with KMS (Rule 1)
  allocated_storage     = 100
  max_allocated_storage = 500
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.rds.arn

  # Network — private subnet, never public (Rule 10)
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [var.database_sg_id]
  publicly_accessible    = false
  multi_az               = true

  # Parameters
  parameter_group_name = aws_db_parameter_group.postgresql.name

  # Backup — 35-day retention minimum
  backup_retention_period = var.backup_retention_period
  backup_window           = "03:00-04:00"
  maintenance_window      = "Mon:04:00-Mon:05:00"

  # Monitoring
  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.rds.arn
  performance_insights_retention_period = var.environment == "production" ? 731 : 7
  monitoring_interval                   = 60
  monitoring_role_arn                   = aws_iam_role.rds_monitoring.arn
  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]

  # Protection
  deletion_protection       = var.environment == "production"
  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "ordr-connect-final-${var.environment}" : null
  copy_tags_to_snapshot     = true
  auto_minor_version_upgrade = true

  tags = {
    Name        = "ordr-rds-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
    Compliance  = "hipaa-soc2"
  }
}

# ---------------------------------------------------------------------------
# Enhanced Monitoring IAM Role
# ---------------------------------------------------------------------------

resource "aws_iam_role" "rds_monitoring" {
  name = "ordr-rds-monitoring-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "monitoring.rds.amazonaws.com"
      }
    }]
  })

  tags = {
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
  role       = aws_iam_role.rds_monitoring.name
}
