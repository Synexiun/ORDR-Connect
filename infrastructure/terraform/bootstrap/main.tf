# =============================================================================
# ORDR-Connect — Terraform State Bootstrap
# One-time bootstrap — run once, never destroy
#
# Purpose: Creates the S3 bucket, DynamoDB table, and KMS key that all other
#          Terraform environments (staging, production) use as their remote
#          backend. Because these resources MUST exist before `terraform init`
#          can succeed on any environment, they are managed here with LOCAL
#          state (no backend block).
#
# Usage:
#   cd infrastructure/terraform/bootstrap
#   terraform init
#   terraform apply
#
# WARNING: Do NOT run `terraform destroy` — destroying these resources will
#          orphan all environment state files.
# =============================================================================

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }

  # NO backend block — state is stored locally (terraform.tfstate)
  # The local terraform.tfstate is excluded from git via .gitignore (*.tfstate)
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region for all bootstrap resources"
  type        = string
  default     = "us-east-1"
}

# =============================================================================
# KMS Key — encrypts S3 state objects and DynamoDB lock table
# =============================================================================

resource "aws_kms_key" "terraform_state" {
  description             = "KMS key for ORDR-Connect Terraform state encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name    = "ordr-connect-terraform-state"
    Purpose = "terraform-state-encryption"
  }
}

resource "aws_kms_alias" "terraform_state" {
  name          = "alias/ordr-connect-terraform"
  target_key_id = aws_kms_key.terraform_state.key_id
}

# =============================================================================
# S3 Bucket — stores Terraform state files
# =============================================================================

resource "aws_s3_bucket" "terraform_state" {
  bucket = "ordr-connect-terraform-state"

  # Prevent accidental deletion — must be removed manually if intentional
  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name        = "ordr-connect-terraform-state"
    Environment = "shared"
    Compliance  = "SOC2-ISO27001-HIPAA"
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.terraform_state.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# =============================================================================
# DynamoDB Table — state locking (prevents concurrent applies)
# =============================================================================

resource "aws_dynamodb_table" "terraform_locks" {
  name         = "ordr-connect-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.terraform_state.arn
  }

  point_in_time_recovery {
    enabled = true
  }

  # Prevent accidental deletion — must be removed manually if intentional
  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name        = "ordr-connect-terraform-locks"
    Environment = "shared"
  }
}
