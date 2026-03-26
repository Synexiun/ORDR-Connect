# ============================================================================
# ORDR-Connect — HashiCorp Vault Module
# Vault on EKS via Helm, KMS auto-unseal, HA Raft, audit to CloudWatch
# Rule 5: HSM-backed secret management | Rule 3: audit logging
# ============================================================================

# ---------------------------------------------------------------------------
# KMS Key for Vault auto-unseal
# ---------------------------------------------------------------------------

resource "aws_kms_key" "vault" {
  description             = "Vault auto-unseal key — ${var.environment}"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "ordr-vault-kms-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_kms_alias" "vault" {
  name          = "alias/ordr-vault-${var.environment}"
  target_key_id = aws_kms_key.vault.key_id
}

# ---------------------------------------------------------------------------
# CloudWatch Log Group for Vault audit logs
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "vault_audit" {
  name              = "/vault/ordr-connect-${var.environment}/audit"
  retention_in_days = 2557

  tags = {
    Name        = "ordr-vault-audit-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
    Compliance  = "hipaa-soc2"
  }
}

# ---------------------------------------------------------------------------
# Kubernetes Namespace for Vault
# ---------------------------------------------------------------------------

resource "kubernetes_namespace" "vault" {
  metadata {
    name = "vault"

    labels = {
      "pod-security.kubernetes.io/enforce" = "restricted"
      "pod-security.kubernetes.io/audit"   = "restricted"
      "pod-security.kubernetes.io/warn"    = "restricted"
    }
  }
}

# ---------------------------------------------------------------------------
# Vault Helm Release — HA with Raft backend
# ---------------------------------------------------------------------------

resource "helm_release" "vault" {
  name       = "vault"
  namespace  = kubernetes_namespace.vault.metadata[0].name
  repository = "https://helm.releases.hashicorp.com"
  chart      = "vault"
  version    = "0.28.0"
  timeout    = 600

  values = [yamlencode({
    global = {
      enabled    = true
      tlsDisable = false
    }

    server = {
      ha = {
        enabled  = true
        replicas = var.vault_replicas
        raft = {
          enabled   = true
          setNodeId = true
          config = <<-EOF
            ui = true

            listener "tcp" {
              address       = "[::]:8200"
              tls_disable   = false
              tls_cert_file = "/vault/tls/tls.crt"
              tls_key_file  = "/vault/tls/tls.key"
            }

            storage "raft" {
              path = "/vault/data"
              retry_join {
                leader_api_addr = "https://vault-0.vault-internal:8200"
              }
              retry_join {
                leader_api_addr = "https://vault-1.vault-internal:8200"
              }
              retry_join {
                leader_api_addr = "https://vault-2.vault-internal:8200"
              }
            }

            seal "awskms" {
              region     = data.aws_region.current.name
              kms_key_id = aws_kms_key.vault.id
            }

            telemetry {
              prometheus_retention_time = "24h"
              disable_hostname         = true
            }
          EOF
        }
      }

      auditStorage = {
        enabled = true
        size    = "10Gi"
      }

      dataStorage = {
        enabled = true
        size    = "10Gi"
      }

      resources = {
        requests = {
          memory = "256Mi"
          cpu    = "250m"
        }
        limits = {
          memory = "512Mi"
          cpu    = "500m"
        }
      }

      securityContext = {
        runAsNonRoot = true
        runAsUser    = 100
        runAsGroup   = 1000
        fsGroup      = 1000
      }
    }

    injector = {
      enabled = true
      resources = {
        requests = {
          memory = "64Mi"
          cpu    = "50m"
        }
        limits = {
          memory = "128Mi"
          cpu    = "100m"
        }
      }
    }

    ui = {
      enabled = var.environment == "staging"
    }
  })]

  tags = {
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Data source for region
# ---------------------------------------------------------------------------

data "aws_region" "current" {}
