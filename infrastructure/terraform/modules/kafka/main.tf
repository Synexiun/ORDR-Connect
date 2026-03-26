# ============================================================================
# ORDR-Connect — Kafka (MSK) Module
# Amazon MSK with SASL/SCRAM, TLS, KMS encryption, Schema Registry
# Rule 1: TLS + KMS | Rule 2: SASL/SCRAM auth | Rule 3: CloudWatch metrics
# ============================================================================

# ---------------------------------------------------------------------------
# KMS Key for MSK encryption at rest
# ---------------------------------------------------------------------------

resource "aws_kms_key" "kafka" {
  description             = "MSK encryption key — ${var.environment}"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "ordr-kafka-kms-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_kms_alias" "kafka" {
  name          = "alias/ordr-kafka-${var.environment}"
  target_key_id = aws_kms_key.kafka.key_id
}

# ---------------------------------------------------------------------------
# CloudWatch Log Group for MSK broker logs
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "kafka" {
  name              = "/msk/ordr-connect-${var.environment}"
  retention_in_days = 365

  tags = {
    Name        = "ordr-kafka-logs-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# SASL/SCRAM Secret for MSK authentication — Rule 5
# ---------------------------------------------------------------------------

resource "random_password" "kafka_sasl" {
  length           = 32
  special          = true
  override_special = "!#$%^&*"
}

resource "aws_secretsmanager_secret" "kafka_sasl" {
  name                    = "AmazonMSK_ordr-connect-${var.environment}"
  description             = "MSK SASL/SCRAM credentials for ${var.environment}"
  recovery_window_in_days = 30
  kms_key_id              = aws_kms_key.kafka.arn

  tags = {
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_secretsmanager_secret_version" "kafka_sasl" {
  secret_id = aws_secretsmanager_secret.kafka_sasl.id
  secret_string = jsonencode({
    username = "ordr-connect-${var.environment}"
    password = random_password.kafka_sasl.result
  })
}

# ---------------------------------------------------------------------------
# MSK Configuration
# ---------------------------------------------------------------------------

resource "aws_msk_configuration" "main" {
  name              = "ordr-connect-${var.environment}"
  kafka_versions    = ["3.6.0"]
  description       = "ORDR-Connect MSK configuration — ${var.environment}"

  server_properties = <<-PROPERTIES
    auto.create.topics.enable=false
    default.replication.factor=3
    min.insync.replicas=2
    num.partitions=6
    log.retention.hours=168
    log.retention.bytes=-1
    delete.topic.enable=false
    unclean.leader.election.enable=false
  PROPERTIES

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# MSK Cluster
# ---------------------------------------------------------------------------

resource "aws_msk_cluster" "main" {
  cluster_name           = "ordr-connect-${var.environment}"
  kafka_version          = "3.6.0"
  number_of_broker_nodes = var.broker_count

  configuration_info {
    arn      = aws_msk_configuration.main.arn
    revision = aws_msk_configuration.main.latest_revision
  }

  broker_node_group_info {
    instance_type  = var.broker_instance_type
    client_subnets = var.private_subnet_ids
    security_groups = [var.kafka_sg_id]

    storage_info {
      ebs_storage_info {
        volume_size = var.environment == "production" ? 500 : 100

        provisioned_throughput {
          enabled           = var.environment == "production"
          volume_throughput  = var.environment == "production" ? 250 : 0
        }
      }
    }
  }

  # Encryption — Rule 1
  encryption_info {
    encryption_at_rest_kms_key_arn = aws_kms_key.kafka.arn

    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
  }

  # Authentication — SASL/SCRAM (Rule 2)
  client_authentication {
    sasl {
      scram = true
    }
    unauthenticated = false
  }

  # Logging — Rule 3
  logging_info {
    broker_logs {
      cloudwatch_logs {
        enabled   = true
        log_group = aws_cloudwatch_log_group.kafka.name
      }
    }
  }

  # Monitoring
  enhanced_monitoring = "PER_TOPIC_PER_PARTITION"

  open_monitoring {
    prometheus {
      jmx_exporter {
        enabled_in_broker = true
      }
      node_exporter {
        enabled_in_broker = true
      }
    }
  }

  tags = {
    Name        = "ordr-kafka-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
    Compliance  = "soc2-iso27001"
  }
}

# ---------------------------------------------------------------------------
# Associate SASL/SCRAM secret with MSK cluster
# ---------------------------------------------------------------------------

resource "aws_msk_scram_secret_association" "main" {
  cluster_arn     = aws_msk_cluster.main.arn
  secret_arn_list = [aws_secretsmanager_secret.kafka_sasl.arn]

  depends_on = [aws_secretsmanager_secret_version.kafka_sasl]
}

# ---------------------------------------------------------------------------
# Schema Registry (AWS Glue)
# ---------------------------------------------------------------------------

resource "aws_glue_registry" "main" {
  registry_name = "ordr-connect-${var.environment}"
  description   = "Schema registry for ORDR-Connect event sourcing — ${var.environment}"

  tags = {
    Name        = "ordr-schema-registry-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
