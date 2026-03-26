# ============================================================================
# Monitoring Module — Outputs
# ============================================================================

output "namespace" {
  description = "Kubernetes namespace for monitoring stack"
  value       = kubernetes_namespace.monitoring.metadata[0].name
}

output "prometheus_release_name" {
  description = "Prometheus Helm release name"
  value       = helm_release.kube_prometheus_stack.name
}

output "loki_release_name" {
  description = "Loki Helm release name"
  value       = helm_release.loki.name
}
