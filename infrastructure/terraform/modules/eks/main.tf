# ============================================================================
# ORDR-Connect — EKS Module
# Managed Kubernetes with IRSA, Pod Security Standards, full audit logging
# ============================================================================

data "aws_caller_identity" "current" {}

# ---------------------------------------------------------------------------
# KMS Key for EKS envelope encryption
# ---------------------------------------------------------------------------

resource "aws_kms_key" "eks" {
  description             = "EKS envelope encryption key — ${var.environment}"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  tags = {
    Name        = "ordr-eks-kms-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_kms_alias" "eks" {
  name          = "alias/ordr-eks-${var.environment}"
  target_key_id = aws_kms_key.eks.key_id
}

# ---------------------------------------------------------------------------
# IAM Role for EKS Cluster
# ---------------------------------------------------------------------------

resource "aws_iam_role" "cluster" {
  name = "ordr-eks-cluster-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "eks.amazonaws.com"
      }
    }]
  })

  tags = {
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_iam_role_policy_attachment" "cluster_policy" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
  role       = aws_iam_role.cluster.name
}

resource "aws_iam_role_policy_attachment" "cluster_vpc_controller" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSVPCResourceController"
  role       = aws_iam_role.cluster.name
}

# ---------------------------------------------------------------------------
# EKS Cluster
# ---------------------------------------------------------------------------

resource "aws_eks_cluster" "main" {
  name     = "ordr-connect-${var.environment}"
  version  = var.cluster_version
  role_arn = aws_iam_role.cluster.arn

  vpc_config {
    subnet_ids              = var.private_subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = var.environment == "staging" ? true : false
    security_group_ids      = [var.api_security_group_id]
  }

  encryption_config {
    provider {
      key_arn = aws_kms_key.eks.arn
    }
    resources = ["secrets"]
  }

  # Full audit logging — Rule 3 / Rule 10
  enabled_cluster_log_types = [
    "api",
    "audit",
    "authenticator",
    "controllerManager",
    "scheduler"
  ]

  tags = {
    Name        = "ordr-eks-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  depends_on = [
    aws_iam_role_policy_attachment.cluster_policy,
    aws_iam_role_policy_attachment.cluster_vpc_controller,
  ]
}

# ---------------------------------------------------------------------------
# OIDC Provider for IRSA (IAM Roles for Service Accounts)
# ---------------------------------------------------------------------------

data "aws_iam_openid_connect_provider" "eks" {
  url = aws_eks_cluster.main.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "eks" {
  count = length(try(data.aws_iam_openid_connect_provider.eks.arn, "")) > 0 ? 0 : 1

  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks.certificates[0].sha1_fingerprint]
  url             = aws_eks_cluster.main.identity[0].oidc[0].issuer

  tags = {
    Name        = "ordr-eks-oidc-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

data "tls_certificate" "eks" {
  url = aws_eks_cluster.main.identity[0].oidc[0].issuer
}

# ---------------------------------------------------------------------------
# IAM Role for Node Groups
# ---------------------------------------------------------------------------

resource "aws_iam_role" "node_group" {
  name = "ordr-eks-nodes-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })

  tags = {
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

resource "aws_iam_role_policy_attachment" "node_worker" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.node_group.name
}

resource "aws_iam_role_policy_attachment" "node_cni" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.node_group.name
}

resource "aws_iam_role_policy_attachment" "node_ecr" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = aws_iam_role.node_group.name
}

# ---------------------------------------------------------------------------
# Managed Node Groups
# ---------------------------------------------------------------------------

# General workloads (API, web, workers)
resource "aws_eks_node_group" "general" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "ordr-general-${var.environment}"
  node_role_arn   = aws_iam_role.node_group.arn
  subnet_ids      = var.private_subnet_ids

  instance_types = var.environment == "production" ? ["m6i.xlarge"] : ["m6i.large"]

  scaling_config {
    desired_size = var.environment == "production" ? 3 : 2
    min_size     = var.environment == "production" ? 3 : 1
    max_size     = var.environment == "production" ? 10 : 5
  }

  update_config {
    max_unavailable = 1
  }

  labels = {
    workload = "general"
  }

  tags = {
    Name        = "ordr-general-nodes-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  depends_on = [
    aws_iam_role_policy_attachment.node_worker,
    aws_iam_role_policy_attachment.node_cni,
    aws_iam_role_policy_attachment.node_ecr,
  ]
}

# Compute-optimized for agent-runtime (AI workloads)
resource "aws_eks_node_group" "agent_runtime" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "ordr-agent-runtime-${var.environment}"
  node_role_arn   = aws_iam_role.node_group.arn
  subnet_ids      = var.private_subnet_ids

  instance_types = var.environment == "production" ? ["c6i.2xlarge"] : ["c6i.xlarge"]

  scaling_config {
    desired_size = var.environment == "production" ? 2 : 1
    min_size     = var.environment == "production" ? 2 : 0
    max_size     = var.environment == "production" ? 8 : 3
  }

  update_config {
    max_unavailable = 1
  }

  labels = {
    workload = "agent-runtime"
  }

  taint {
    key    = "workload"
    value  = "agent-runtime"
    effect = "NO_SCHEDULE"
  }

  tags = {
    Name        = "ordr-agent-runtime-nodes-${var.environment}"
    Project     = "ordr-connect"
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  depends_on = [
    aws_iam_role_policy_attachment.node_worker,
    aws_iam_role_policy_attachment.node_cni,
    aws_iam_role_policy_attachment.node_ecr,
  ]
}

# ---------------------------------------------------------------------------
# Pod Security Standards — Restricted (Rule 10)
# ---------------------------------------------------------------------------

resource "kubernetes_namespace" "ordr" {
  metadata {
    name = "ordr-connect"

    labels = {
      "pod-security.kubernetes.io/enforce"         = "restricted"
      "pod-security.kubernetes.io/enforce-version"  = "latest"
      "pod-security.kubernetes.io/audit"            = "restricted"
      "pod-security.kubernetes.io/audit-version"    = "latest"
      "pod-security.kubernetes.io/warn"             = "restricted"
      "pod-security.kubernetes.io/warn-version"     = "latest"
    }
  }

  depends_on = [aws_eks_cluster.main]
}
