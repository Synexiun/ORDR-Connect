# ============================================================================
# ORDR-Connect — S3 Module
# Audit (WORM/Object Lock), SBOM, Backup buckets — all encrypted + versioned
# Rule 1: AES-256-KMS | Rule 3: WORM 7yr retention | Rule 8: SBOM storage
# ============================================================================

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# KMS Key for S3 encryption
# ---------------------------------------------------------------------------

resource "aws_kms_key" "s3" {
  description             = "S3 bucket encryption key — ${var.environment}"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "ordr-s3-kms-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_kms_alias" "s3" {
  name          = "alias/ordr-s3-${var.environment}"
  target_key_id = aws_kms_key.s3.key_id
}

# ---------------------------------------------------------------------------
# Access Logging Bucket
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "access_logs" {
  bucket = "ordr-connect-access-logs-${var.environment}-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name        = "ordr-access-logs-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_s3_bucket_versioning" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "access_logs" {
  bucket = aws_s3_bucket.access_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "access_logs" {
  bucket                  = aws_s3_bucket.access_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---------------------------------------------------------------------------
# Audit Log Bucket — S3 Object Lock, Compliance mode, 7-year retention
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "audit" {
  bucket              = "ordr-connect-audit-logs-${var.environment}-${data.aws_caller_identity.current.account_id}"
  object_lock_enabled = true

  tags = {
    Name        = "ordr-audit-logs-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
    Compliance  = "hipaa-soc2-worm"
  }
}

resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id

  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = var.audit_retention_days
    }
  }
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_logging" "audit" {
  bucket        = aws_s3_bucket.audit.id
  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "audit-logs/"
}

# ---------------------------------------------------------------------------
# SBOM Artifact Bucket
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "sbom" {
  bucket = "ordr-connect-sbom-${var.environment}-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name        = "ordr-sbom-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
    Compliance  = "soc2-supply-chain"
  }
}

resource "aws_s3_bucket_versioning" "sbom" {
  bucket = aws_s3_bucket.sbom.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "sbom" {
  bucket = aws_s3_bucket.sbom.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "sbom" {
  bucket                  = aws_s3_bucket.sbom.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_logging" "sbom" {
  bucket        = aws_s3_bucket.sbom.id
  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "sbom/"
}

# ---------------------------------------------------------------------------
# Backup Bucket — Cross-region replication
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "backup" {
  bucket = "ordr-connect-backups-${var.environment}-${data.aws_caller_identity.current.account_id}"

  tags = {
    Name        = "ordr-backups-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
    Compliance  = "hipaa-backup"
  }
}

resource "aws_s3_bucket_versioning" "backup" {
  bucket = aws_s3_bucket.backup.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.s3.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "backup" {
  bucket                  = aws_s3_bucket.backup.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_logging" "backup" {
  bucket        = aws_s3_bucket.backup.id
  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "backups/"
}

resource "aws_s3_bucket_lifecycle_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    id     = "transition-to-glacier"
    status = "Enabled"

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    transition {
      days          = 365
      storage_class = "DEEP_ARCHIVE"
    }
  }
}

# ---------------------------------------------------------------------------
# Cross-Region Replication for Backup
# ---------------------------------------------------------------------------

resource "aws_iam_role" "replication" {
  name = "ordr-s3-replication-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "s3.amazonaws.com"
      }
    }]
  })

  tags = {
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_iam_role_policy" "replication" {
  name = "ordr-s3-replication-policy-${var.environment}"
  role = aws_iam_role.replication.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "s3:GetReplicationConfiguration",
          "s3:ListBucket"
        ]
        Effect   = "Allow"
        Resource = aws_s3_bucket.backup.arn
      },
      {
        Action = [
          "s3:GetObjectVersionForReplication",
          "s3:GetObjectVersionAcl",
          "s3:GetObjectVersionTagging"
        ]
        Effect   = "Allow"
        Resource = "${aws_s3_bucket.backup.arn}/*"
      },
      {
        Action = [
          "s3:ReplicateObject",
          "s3:ReplicateDelete",
          "s3:ReplicateTags"
        ]
        Effect   = "Allow"
        Resource = "arn:aws:s3:::ordr-connect-backups-replica-${var.environment}-${data.aws_caller_identity.current.account_id}/*"
      }
    ]
  })
}
