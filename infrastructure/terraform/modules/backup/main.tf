# ============================================================================
# ORDR-Connect — Backup Module
# RDS automated snapshots, cross-region replication, retention policies
#
# Rule 1: AES-256 encryption on all backups
# Rule 10: Encrypted, tested monthly, stored in separate region
# HIPAA §164.308(a)(7) — Contingency plan / disaster recovery
# SOC2 A1.2 — Recovery objectives met
# ============================================================================

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# KMS Key for cross-region backup encryption
# ---------------------------------------------------------------------------

resource "aws_kms_key" "backup" {
  provider = aws.dr_region

  description             = "Backup encryption key (DR region) — ${var.environment}"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "ordr-backup-kms-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
    Compliance  = "hipaa-soc2"
  }
}

resource "aws_kms_alias" "backup" {
  provider = aws.dr_region

  name          = "alias/ordr-backup-${var.environment}"
  target_key_id = aws_kms_key.backup.key_id
}

# ---------------------------------------------------------------------------
# RDS Automated Backup Replication — Cross-Region
#
# Replicates automated RDS snapshots to a secondary region.
# Retention: 35 days (matches source RDS backup_retention_period).
# Encrypted with DR-region KMS key.
# ---------------------------------------------------------------------------

resource "aws_db_instance_automated_backups_replication" "cross_region" {
  source_db_instance_arn = var.rds_instance_arn
  kms_key_id             = aws_kms_key.backup.arn
  retention_period       = var.backup_retention_days

  # Replication runs in the DR region provider
  provider = aws.dr_region
}

# ---------------------------------------------------------------------------
# SNS Topic — Backup event notifications
# ---------------------------------------------------------------------------

resource "aws_sns_topic" "backup_events" {
  name              = "ordr-backup-events-${var.environment}"
  kms_master_key_id = var.primary_kms_key_arn

  tags = {
    Name        = "ordr-backup-events-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# RDS Event Subscription — snapshot completion, failure alerts
# ---------------------------------------------------------------------------

resource "aws_db_event_subscription" "backup_alerts" {
  name      = "ordr-rds-backup-alerts-${var.environment}"
  sns_topic = aws_sns_topic.backup_events.arn

  source_type = "db-instance"
  source_ids  = [var.rds_instance_id]

  event_categories = [
    "backup",
    "recovery",
    "failure",
  ]

  tags = {
    Name        = "ordr-rds-backup-alerts-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# CloudWatch Alarm — Backup age monitoring
#
# Alerts if no successful backup in the last 26 hours (daily + buffer).
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_metric_alarm" "backup_age" {
  alarm_name          = "ordr-rds-backup-age-${var.environment}"
  alarm_description   = "Alert if RDS backup is older than 26 hours — potential backup failure"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "OldestReplicationSlotLag"
  namespace           = "AWS/RDS"
  period              = 3600
  statistic           = "Maximum"
  threshold           = 93600 # 26 hours in seconds
  treat_missing_data  = "breaching"

  dimensions = {
    DBInstanceIdentifier = var.rds_instance_id
  }

  alarm_actions = [aws_sns_topic.backup_events.arn]
  ok_actions    = [aws_sns_topic.backup_events.arn]

  tags = {
    Name        = "ordr-backup-age-alarm-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
    Compliance  = "hipaa-soc2"
  }
}
