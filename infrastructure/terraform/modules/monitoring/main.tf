# ============================================================================
# ORDR-Connect — Monitoring Module
# Grafana + Prometheus + Loki + AlertManager on EKS
# Rule 10: observability stack for security event alerting
# ============================================================================

# ---------------------------------------------------------------------------
# Kubernetes Namespace for Monitoring
# ---------------------------------------------------------------------------

resource "kubernetes_namespace" "monitoring" {
  metadata {
    name = "monitoring"

    labels = {
      "pod-security.kubernetes.io/enforce" = "restricted"
      "pod-security.kubernetes.io/audit"   = "restricted"
      "pod-security.kubernetes.io/warn"    = "restricted"
    }
  }
}

# ---------------------------------------------------------------------------
# Prometheus + Grafana + AlertManager (kube-prometheus-stack)
# ---------------------------------------------------------------------------

resource "helm_release" "kube_prometheus_stack" {
  name       = "kube-prometheus-stack"
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  repository = "https://prometheus-community.github.io/helm-charts"
  chart      = "kube-prometheus-stack"
  version    = "58.0.0"
  timeout    = 900

  values = [yamlencode({
    prometheus = {
      prometheusSpec = {
        retention    = var.environment == "production" ? "90d" : "30d"
        storageSpec = {
          volumeClaimTemplate = {
            spec = {
              accessModes = ["ReadWriteOnce"]
              resources = {
                requests = {
                  storage = var.environment == "production" ? "100Gi" : "50Gi"
                }
              }
            }
          }
        }
        resources = {
          requests = {
            memory = "512Mi"
            cpu    = "250m"
          }
          limits = {
            memory = "2Gi"
            cpu    = "1000m"
          }
        }
        securityContext = {
          runAsNonRoot = true
          runAsUser    = 65534
          fsGroup      = 65534
        }
      }
    }

    grafana = {
      enabled = true
      adminPassword = "CHANGE_ME_VIA_VAULT"

      persistence = {
        enabled = true
        size    = "10Gi"
      }

      "grafana.ini" = {
        server = {
          root_url = "https://grafana.ordr-connect.${var.environment == "production" ? "com" : "staging.com"}"
        }
        security = {
          disable_gravatar     = true
          cookie_secure        = true
          strict_transport_security = true
        }
        auth = {
          disable_login_form = false
        }
        analytics = {
          reporting_enabled = false
        }
      }

      resources = {
        requests = {
          memory = "128Mi"
          cpu    = "100m"
        }
        limits = {
          memory = "256Mi"
          cpu    = "200m"
        }
      }

      securityContext = {
        runAsNonRoot = true
        runAsUser    = 472
        fsGroup      = 472
      }
    }

    alertmanager = {
      alertmanagerSpec = {
        storage = {
          volumeClaimTemplate = {
            spec = {
              accessModes = ["ReadWriteOnce"]
              resources = {
                requests = {
                  storage = "5Gi"
                }
              }
            }
          }
        }
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
        securityContext = {
          runAsNonRoot = true
          runAsUser    = 65534
          fsGroup      = 65534
        }
      }

      config = {
        global = {
          resolve_timeout = "5m"
        }
        route = {
          group_by        = ["alertname", "namespace"]
          group_wait      = "10s"
          group_interval  = "5m"
          repeat_interval = "12h"
          receiver        = "default"
          routes = [
            {
              match = {
                severity = "critical"
              }
              receiver        = "critical"
              repeat_interval = "1h"
            }
          ]
        }
        receivers = [
          {
            name = "default"
          },
          {
            name = "critical"
          }
        ]
      }
    }
  })]

  tags = {
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# ---------------------------------------------------------------------------
# Loki — Log aggregation
# ---------------------------------------------------------------------------

resource "helm_release" "loki" {
  name       = "loki"
  namespace  = kubernetes_namespace.monitoring.metadata[0].name
  repository = "https://grafana.github.io/helm-charts"
  chart      = "loki-stack"
  version    = "2.10.0"
  timeout    = 600

  values = [yamlencode({
    loki = {
      enabled = true
      persistence = {
        enabled = true
        size    = var.environment == "production" ? "50Gi" : "20Gi"
      }
      config = {
        auth_enabled = false
        limits_config = {
          retention_period = var.environment == "production" ? "2160h" : "720h"
        }
      }
      resources = {
        requests = {
          memory = "256Mi"
          cpu    = "100m"
        }
        limits = {
          memory = "512Mi"
          cpu    = "200m"
        }
      }
      securityContext = {
        runAsNonRoot = true
        runAsUser    = 10001
        fsGroup      = 10001
      }
    }

    promtail = {
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
  })]

  depends_on = [helm_release.kube_prometheus_stack]

  tags = {
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
