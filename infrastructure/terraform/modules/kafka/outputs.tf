# ============================================================================
# Kafka (MSK) Module — Outputs
# ============================================================================

output "cluster_arn" {
  description = "MSK cluster ARN"
  value       = aws_msk_cluster.main.arn
}

output "bootstrap_brokers_tls" {
  description = "TLS bootstrap broker connection string"
  value       = aws_msk_cluster.main.bootstrap_brokers_tls
  sensitive   = true
}

output "bootstrap_brokers_sasl_scram" {
  description = "SASL/SCRAM bootstrap broker connection string"
  value       = aws_msk_cluster.main.bootstrap_brokers_sasl_scram
  sensitive   = true
}

output "zookeeper_connect_string" {
  description = "ZooKeeper connection string"
  value       = aws_msk_cluster.main.zookeeper_connect_string
  sensitive   = true
}

output "kms_key_arn" {
  description = "KMS key ARN for MSK encryption"
  value       = aws_kms_key.kafka.arn
}

output "sasl_secret_arn" {
  description = "Secrets Manager ARN for SASL/SCRAM credentials"
  value       = aws_secretsmanager_secret.kafka_sasl.arn
}

output "schema_registry_arn" {
  description = "Glue Schema Registry ARN"
  value       = aws_glue_registry.main.arn
}
