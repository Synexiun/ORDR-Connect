# ============================================================================
# ORDR-Connect — Root Terraform Configuration
# SOC 2 Type II | ISO 27001:2022 | HIPAA Compliant
# ============================================================================

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.27"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  backend "s3" {
    bucket         = "ordr-connect-terraform-state"
    key            = "infrastructure/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "ordr-connect-terraform-locks"
    kms_key_id     = "alias/ordr-connect-terraform"
  }
}

# ---------------------------------------------------------------------------
# Provider Configuration
# ---------------------------------------------------------------------------

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "ordr-connect"
      Environment = var.environment
      ManagedBy   = "terraform"
      Compliance  = "soc2-iso27001-hipaa"
    }
  }
}

provider "helm" {
  kubernetes {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_ca_certificate)
    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
    }
  }
}

provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_ca_certificate)
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
  }
}

# ---------------------------------------------------------------------------
# Data Sources
# ---------------------------------------------------------------------------

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

# ---------------------------------------------------------------------------
# Modules
# ---------------------------------------------------------------------------

module "networking" {
  source = "./modules/networking"

  environment        = var.environment
  vpc_cidr           = var.vpc_cidr
  availability_zones = slice(data.aws_availability_zones.available.names, 0, 3)
}

module "eks" {
  source = "./modules/eks"

  environment        = var.environment
  cluster_version    = var.eks_cluster_version
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  api_security_group_id = module.networking.api_security_group_id

  depends_on = [module.networking]
}

module "rds" {
  source = "./modules/rds"

  environment            = var.environment
  vpc_id                 = module.networking.vpc_id
  private_subnet_ids     = module.networking.private_subnet_ids
  database_sg_id         = module.networking.database_security_group_id
  instance_class         = var.rds_instance_class
  db_name                = var.db_name
  master_username        = var.db_master_username
  backup_retention_period = var.db_backup_retention_days

  depends_on = [module.networking]
}

module "redis" {
  source = "./modules/redis"

  environment        = var.environment
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  redis_sg_id        = module.networking.redis_security_group_id
  node_type          = var.redis_node_type
  num_cache_clusters = var.redis_num_cache_clusters

  depends_on = [module.networking]
}

module "kafka" {
  source = "./modules/kafka"

  environment        = var.environment
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
  kafka_sg_id        = module.networking.kafka_security_group_id
  broker_instance_type = var.kafka_broker_instance_type
  broker_count       = var.kafka_broker_count

  depends_on = [module.networking]
}

module "s3" {
  source = "./modules/s3"

  environment          = var.environment
  audit_retention_days = var.audit_retention_days
  backup_region        = var.backup_region
}

module "vault" {
  source = "./modules/vault"

  environment    = var.environment
  eks_cluster_id = module.eks.cluster_id
  vault_replicas = var.vault_replicas

  depends_on = [module.eks]
}

module "monitoring" {
  source = "./modules/monitoring"

  environment    = var.environment
  eks_cluster_id = module.eks.cluster_id

  depends_on = [module.eks]
}
