# ============================================================================
# ORDR-Connect — WAF (AWS WAFv2) Module
# Regional WebACL for ALB protection — OWASP, IP reputation, rate limiting
# SOC 2 CC6.6 | ISO 27001 A.8.23 | HIPAA §164.312(e)(1)
# ============================================================================
#
# This module provisions an AWS WAFv2 regional WebACL with:
#   - AWS-managed rule groups (Common, KnownBadInputs, SQLi, Linux, IpReputation)
#   - Per-IP rate limiting (5-minute sliding window)
#   - Optional geo-blocking (empty list = disabled)
#   - CloudWatch Logs destination with KMS-encrypted retention
#
# Body-size enforcement is intentionally delegated to the nginx ingress
# (proxy-body-size: 1m) rather than WAF — regional WAFv2 only inspects the
# first 16 KB of request bodies by default, which makes a 1 MiB size check
# unreliable without per-rule association_config tuning.
#
# The ACL is NOT auto-associated with any ALB here — the ALB is provisioned
# by the AWS Load Balancer Controller in EKS. Association happens via:
#   1. Ingress annotation: alb.ingress.kubernetes.io/wafv2-acl-arn
#   2. Explicit aws_wafv2_web_acl_association resource (if ALB is Terraform-managed)
#
# The ARN is exported via outputs so downstream modules / CI can wire it.

# ---------------------------------------------------------------------------
# WebACL — default allow, rules explicitly block
# ---------------------------------------------------------------------------

resource "aws_wafv2_web_acl" "main" {
  name        = "ordr-connect-${var.environment}"
  description = "ORDR-Connect ${var.environment} — OWASP + rate limit + IP reputation"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  # ── Rule 1: IP Reputation ────────────────────────────────────────────────
  # Blocks IPs AWS identifies as sources of malicious traffic.
  rule {
    name     = "AWSManagedRulesAmazonIpReputationList"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesAmazonIpReputationList"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "IpReputation"
      sampled_requests_enabled   = true
    }
  }

  # ── Rule 2: Core Rule Set (OWASP Top 10 baseline) ────────────────────────
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"

        # CRS body-size rule triggers at 8 KB which would false-positive on
        # our JSON API payloads (profile updates, bulk imports). Downgrade to
        # COUNT for observability; nginx enforces the real 1 MiB cap upstream.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "CommonRuleSet"
      sampled_requests_enabled   = true
    }
  }

  # ── Rule 3: Known bad inputs (CVE payloads, exploit signatures) ──────────
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "KnownBadInputs"
      sampled_requests_enabled   = true
    }
  }

  # ── Rule 4: SQL injection ────────────────────────────────────────────────
  # Belt-and-braces with parameterized queries (Rule 4 in CLAUDE.md).
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 4

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesSQLiRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "SQLi"
      sampled_requests_enabled   = true
    }
  }

  # ── Rule 5: Linux exploit signatures ─────────────────────────────────────
  rule {
    name     = "AWSManagedRulesLinuxRuleSet"
    priority = 5

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesLinuxRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "LinuxRuleSet"
      sampled_requests_enabled   = true
    }
  }

  # ── Rule 10: Per-IP rate limit (sliding 5-minute window) ─────────────────
  # Complements application-layer rateLimit() middleware — WAF catches
  # volumetric abuse before the app ever sees it.
  rule {
    name     = "RateLimitPerIP"
    priority = 10

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = var.rate_limit_per_5min
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "RateLimit"
      sampled_requests_enabled   = true
    }
  }

  # ── Rule 30: Geo-block (optional — empty list = no-op) ───────────────────
  # Populate var.blocked_country_codes only under explicit compliance/legal
  # guidance (e.g. OFAC sanctions list). Default is empty to avoid surprise blocks.
  dynamic "rule" {
    for_each = length(var.blocked_country_codes) > 0 ? [1] : []

    content {
      name     = "GeoBlock"
      priority = 30

      action {
        block {}
      }

      statement {
        geo_match_statement {
          country_codes = var.blocked_country_codes
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "GeoBlock"
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "ordr-connect-${var.environment}"
    sampled_requests_enabled   = true
  }

  tags = {
    Name        = "ordr-waf-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
    Compliance  = "soc2-iso27001-hipaa"
  }
}

# ---------------------------------------------------------------------------
# KMS key — encrypts WAF CloudWatch log streams at rest (Rule 1)
# ---------------------------------------------------------------------------

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_kms_key" "waf_logs" {
  description             = "ORDR-Connect WAF log encryption (${var.environment})"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnableRootPermissions"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowCloudWatchLogsEncrypt"
        Effect = "Allow"
        Principal = {
          Service = "logs.${data.aws_region.current.name}.amazonaws.com"
        }
        Action = [
          "kms:Encrypt*",
          "kms:Decrypt*",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:Describe*"
        ]
        Resource = "*"
        Condition = {
          ArnLike = {
            "kms:EncryptionContext:aws:logs:arn" = "arn:aws:logs:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:log-group:aws-waf-logs-ordr-connect-${var.environment}"
          }
        }
      }
    ]
  })

  tags = {
    Name        = "ordr-waf-logs-kms-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_kms_alias" "waf_logs" {
  name          = "alias/ordr-connect-waf-logs-${var.environment}"
  target_key_id = aws_kms_key.waf_logs.key_id
}

# ---------------------------------------------------------------------------
# CloudWatch Log Group — WAF-specific naming prefix required by AWS
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "waf" {
  # WAF requires the log group name to start with "aws-waf-logs-"
  name              = "aws-waf-logs-ordr-connect-${var.environment}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.waf_logs.arn

  tags = {
    Name        = "ordr-waf-logs-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Logging Configuration — redact sensitive headers (Rule 5, Rule 6)
# ---------------------------------------------------------------------------

resource "aws_wafv2_web_acl_logging_configuration" "main" {
  resource_arn            = aws_wafv2_web_acl.main.arn
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]

  # Strip auth / session / API-key headers from logs — never log secrets (Rule 5)
  redacted_fields {
    single_header {
      name = "authorization"
    }
  }

  redacted_fields {
    single_header {
      name = "cookie"
    }
  }

  redacted_fields {
    single_header {
      name = "x-api-key"
    }
  }

  redacted_fields {
    single_header {
      name = "x-ordr-signature"
    }
  }

  # Only log requests WAF acted on (BLOCK/COUNT) — reduces noise + cost.
  logging_filter {
    default_behavior = "DROP"

    filter {
      behavior    = "KEEP"
      requirement = "MEETS_ANY"

      condition {
        action_condition {
          action = "BLOCK"
        }
      }

      condition {
        action_condition {
          action = "COUNT"
        }
      }
    }
  }
}
