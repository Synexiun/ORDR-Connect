# Phase 50 — Staging Deployment Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the ORDR-Connect staging environment end-to-end: Terraform infrastructure on AWS, Kubernetes workloads via kustomize overlay, and GitHub Actions CI/CD pipeline wired with correct secrets.

**Architecture:** Bootstrap Terraform state backend (S3 + DynamoDB + KMS) → `terraform apply` staging overlay → configure EKS kubeconfig → apply kustomize staging manifests → wire GitHub Actions secrets → trigger first automated deploy via `develop` branch push.

**Tech Stack:** Terraform ≥ 1.6, AWS CLI v2, kubectl, kustomize (built into kubectl), GitHub CLI (`gh`), bash

---

## Pre-flight checklist (human steps — required before any task below)

These cannot be automated — they require human AWS credentials and GitHub admin access:

- [ ] AWS credentials configured locally: `aws sts get-caller-identity` returns your account ID
- [ ] AWS account has service limits for: EKS, RDS (Multi-AZ), MSK (3 brokers), ElastiCache, NAT Gateway
- [ ] Terraform ≥ 1.6 installed: `terraform version`
- [ ] kubectl installed: `kubectl version --client`
- [ ] GitHub CLI authenticated: `gh auth status`
- [ ] You have GitHub repo admin permissions (needed to set Actions secrets)

---

## Chunk 1: Terraform State Bootstrap + Namespace Fix

### Task 1: Write the bootstrap Terraform module

The staging Terraform backend (`environments/staging/main.tf`) references an S3 bucket, DynamoDB table, and KMS key that must exist before `terraform init` can succeed. They cannot be managed by the same state they're bootstrapping — so we create a separate bootstrap module.

**Files:**
- Create: `infrastructure/terraform/bootstrap/main.tf`
- Create: `infrastructure/terraform/bootstrap/outputs.tf`

- [ ] **Step 1: Write bootstrap/main.tf**

```hcl
# infrastructure/terraform/bootstrap/main.tf
# One-time bootstrap — creates the Terraform state backend resources.
# Run manually with: terraform init && terraform apply
# After this runs successfully, NEVER run it again or destroy it.

terraform {
  required_version = ">= 1.6.0"
  # No backend block — state is stored locally (.terraform/terraform.tfstate)
  # Commit the generated terraform.tfstate to a SECURE location (not this repo)
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

# KMS key for encrypting Terraform state
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

# S3 bucket for Terraform state
resource "aws_s3_bucket" "terraform_state" {
  bucket = "ordr-connect-terraform-state"

  # Prevent accidental deletion
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
      kms_master_key_id = aws_kms_key.terraform_state.arn
      sse_algorithm     = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket                  = aws_s3_bucket.terraform_state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id
  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    noncurrent_version_expiration {
      noncurrent_days = 90
    }
  }
}

# DynamoDB table for state locking
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

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    Name        = "ordr-connect-terraform-locks"
    Environment = "shared"
  }
}
```

- [ ] **Step 2: Write bootstrap/outputs.tf**

```hcl
# infrastructure/terraform/bootstrap/outputs.tf

output "state_bucket_name" {
  value = aws_s3_bucket.terraform_state.id
}

output "state_bucket_arn" {
  value = aws_s3_bucket.terraform_state.arn
}

output "dynamodb_table_name" {
  value = aws_dynamodb_table.terraform_locks.name
}

output "kms_key_arn" {
  value = aws_kms_key.terraform_state.arn
}

output "kms_key_alias" {
  value = aws_kms_alias.terraform_state.name
}
```

- [ ] **Step 3: Validate bootstrap module**

```bash
cd infrastructure/terraform/bootstrap
terraform init
terraform validate
```

Expected output: `Success! The configuration is valid.`

- [ ] **Step 4: Plan bootstrap**

```bash
terraform plan -out=bootstrap.tfplan
```

Review the plan. Should show: 1 KMS key, 1 KMS alias, 1 S3 bucket + 4 S3 sub-resources, 1 DynamoDB table = ~8 resources.

- [ ] **Step 5: Apply bootstrap**

```bash
terraform apply bootstrap.tfplan
```

Expected: `Apply complete! Resources: 8 added, 0 changed, 0 destroyed.`

- [ ] **Step 6: Verify all 3 backend resources exist**

```bash
aws s3 ls | grep ordr-connect-terraform-state
aws dynamodb describe-table --table-name ordr-connect-terraform-locks --query 'Table.TableStatus'
aws kms describe-key --key-id alias/ordr-connect-terraform --query 'KeyMetadata.KeyState'
```

Expected output:
```
# S3: lists the bucket
"ACTIVE"
"Enabled"
```

- [ ] **Step 7: Commit**

```bash
cd ../../..  # back to repo root
git add infrastructure/terraform/bootstrap/
git commit -m "feat(infra): add one-time Terraform state bootstrap module"
```

---

### Task 2: Fix namespace mismatch between kustomize and CI workflow

The `deploy-staging.yml` workflow deploys to namespace `ordr-staging`, but `infrastructure/kubernetes/overlays/staging/kustomization.yaml` sets `namespace: ordr-system`. This would cause `kubectl set image` to silently target no resources, making the CI deploy appear to succeed while the actual deployment is unchanged.

**Files:**
- Modify: `infrastructure/kubernetes/overlays/staging/kustomization.yaml:9`

- [ ] **Step 1: Write a test that catches the mismatch**

Create a test that greps both files and asserts they agree on the namespace:

```bash
# tests/compliance/check-staging-namespace.sh
#!/bin/bash
set -e

KUSTOMIZE_NS=$(grep '^namespace:' infrastructure/kubernetes/overlays/staging/kustomization.yaml | awk '{print $2}')
CI_NS=$(grep 'namespace=ordr-' .github/workflows/deploy-staging.yml | grep -oP 'ordr-\w+' | head -1)

echo "Kustomize namespace: $KUSTOMIZE_NS"
echo "CI workflow namespace: $CI_NS"

if [ "$KUSTOMIZE_NS" != "$CI_NS" ]; then
  echo "ERROR: namespace mismatch — kustomize uses '$KUSTOMIZE_NS', CI uses '$CI_NS'"
  exit 1
fi
echo "PASS: namespaces match"
```

- [ ] **Step 2: Run the test to confirm it currently fails**

```bash
bash tests/compliance/check-staging-namespace.sh
```

Expected: `ERROR: namespace mismatch — kustomize uses 'ordr-system', CI uses 'ordr-staging'`

- [ ] **Step 3: Fix the kustomization namespace**

In `infrastructure/kubernetes/overlays/staging/kustomization.yaml`, change line 9:

```yaml
# BEFORE
namespace: ordr-system

# AFTER
namespace: ordr-staging
```

- [ ] **Step 4: Run the test again to confirm it passes**

```bash
bash tests/compliance/check-staging-namespace.sh
```

Expected: `PASS: namespaces match`

- [ ] **Step 5: Commit**

```bash
git add infrastructure/kubernetes/overlays/staging/kustomization.yaml \
        tests/compliance/check-staging-namespace.sh
git commit -m "fix(k8s): align staging namespace to ordr-staging (matches CI deploy workflow)"
```

---

## Chunk 2: Terraform Staging Apply

### Task 3: Initialize and validate the staging Terraform workspace

**Files:**
- Read: `infrastructure/terraform/environments/staging/main.tf` (no changes needed)

- [ ] **Step 1: Initialize the staging backend**

```bash
cd infrastructure/terraform/environments/staging
terraform init \
  -backend-config="bucket=ordr-connect-terraform-state" \
  -backend-config="key=staging/terraform.tfstate" \
  -backend-config="region=us-east-1" \
  -backend-config="encrypt=true" \
  -backend-config="dynamodb_table=ordr-connect-terraform-locks" \
  -backend-config="kms_key_id=alias/ordr-connect-terraform"
```

Expected: `Terraform has been successfully initialized!`

- [ ] **Step 2: Validate the staging configuration**

```bash
terraform validate
```

Expected: `Success! The configuration is valid.`

---

### Task 4: Plan and apply the staging infrastructure

- [ ] **Step 1: Generate the staging plan**

```bash
terraform plan -out=staging.tfplan 2>&1 | tee staging-plan.log
```

Review the plan output carefully. Expected resource count: ~80–100 resources (VPC, subnets, security groups, EKS cluster + node groups, RDS, ElastiCache, MSK, S3 buckets, Vault, Prometheus/Grafana/Loki).

Key things to verify in the plan:
- VPC CIDR is `10.1.0.0/16` (not `10.0.0.0/16` — that's prod)
- `environment = "staging"` tags are set
- No `prevent_destroy` conflicts from prod resources

- [ ] **Step 2: Apply staging infrastructure**

> **Warning:** This creates real AWS resources and will incur costs (~$400–600/month for staging). Confirm before proceeding.

```bash
terraform apply staging.tfplan
```

This will take 25–40 minutes. MSK and RDS are the slowest.

Expected final output:
```
Apply complete! Resources: ~90 added, 0 changed, 0 destroyed.

Outputs:
eks_cluster_name = "ordr-connect-staging"
vpc_id           = "vpc-..."
```

- [ ] **Step 3: Capture and store outputs securely**

```bash
terraform output -json > /tmp/staging-outputs.json
# DO NOT commit this file — it contains sensitive endpoints
cat /tmp/staging-outputs.json
```

Note the following values (you'll need them in later tasks):
- `eks_cluster_name`
- `rds_endpoint` (sensitive — use `terraform output -raw rds_endpoint`)
- `redis_endpoint` (sensitive)
- `kafka_brokers` (sensitive)

---

## Chunk 3: Kubernetes Bootstrap

### Task 5: Configure kubectl and apply base manifests

- [ ] **Step 1: Update kubeconfig for the staging cluster**

```bash
aws eks update-kubeconfig \
  --name ordr-connect-staging \
  --region us-east-1 \
  --alias staging
```

Expected: `Updated context staging in ~/.kube/config`

- [ ] **Step 2: Verify cluster access**

```bash
kubectl config use-context staging
kubectl get nodes
```

Expected: 1–2 general nodes + possibly 0 agent-runtime nodes (they scale from 0) in `Ready` state.

- [ ] **Step 3: Create the staging namespace**

```bash
kubectl create namespace ordr-staging
kubectl label namespace ordr-staging \
  pod-security.kubernetes.io/enforce=restricted \
  pod-security.kubernetes.io/audit=restricted \
  pod-security.kubernetes.io/warn=restricted
```

Expected: `namespace/ordr-staging created`

- [ ] **Step 4: Dry-run the kustomize staging overlay**

```bash
kubectl kustomize infrastructure/kubernetes/overlays/staging | \
  kubectl apply --dry-run=client -f - \
  --namespace=ordr-staging
```

Review the output. Should list all deployments, services, HPAs, service accounts, and network policies being created with `(dry run)`.

- [ ] **Step 5: Apply the kustomize staging overlay**

```bash
kubectl apply -k infrastructure/kubernetes/overlays/staging \
  --namespace=ordr-staging
```

Expected: All resources created. Deployments will be in `Pending`/`ImagePullBackOff` until the first CI deploy pushes a real image.

- [ ] **Step 6: Verify pod status**

```bash
kubectl get pods -n ordr-staging
kubectl get svc -n ordr-staging
kubectl get ingress -n ordr-staging
```

Note the external IP/hostname from the ingress — this will be your `STAGING_URL`.

---

### Task 6: Create the Kubernetes ConfigMap and Secret placeholders

The API deployment references `ConfigMap/api-config` and `Secret/api-secrets`. These must exist before pods can start. We create them with staging values from the Terraform outputs.

**Files:**
- Create: `infrastructure/kubernetes/overlays/staging/configmap-api.yaml` (gitignored — contains non-secret config)
- Create: `infrastructure/kubernetes/overlays/staging/secrets-api.yaml` (gitignored — contains sensitive values)

> **Note:** These files must NOT be committed. Add them to `.gitignore`.

- [ ] **Step 1: Add staging config files to .gitignore**

Add to `.gitignore`:
```
infrastructure/kubernetes/overlays/staging/configmap-api.yaml
infrastructure/kubernetes/overlays/staging/secrets-api.yaml
```

- [ ] **Step 2: Create the ConfigMap with staging environment values**

Replace `<rds-endpoint>`, `<redis-endpoint>`, `<kafka-brokers>` with Terraform outputs from Task 4 Step 3:

```bash
kubectl create configmap api-config \
  --namespace=ordr-staging \
  --from-literal=NODE_ENV=staging \
  --from-literal=DATABASE_URL="postgresql://ordr_admin@<rds-endpoint>:5432/ordr_connect?sslmode=verify-full" \
  --from-literal=REDIS_URL="rediss://<redis-endpoint>:6379" \
  --from-literal=KAFKA_BROKERS="<kafka-brokers>" \
  --from-literal=KAFKA_SSL="true" \
  --from-literal=LOG_LEVEL=info \
  --dry-run=client -o yaml | kubectl apply -f -
```

- [ ] **Step 3: Create the Secret with credentials from AWS Secrets Manager**

Fetch secrets from Secrets Manager (they were auto-generated by Terraform):

```bash
RDS_PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id ordr-connect/staging/rds-master-password \
  --query SecretString --output text)

REDIS_TOKEN=$(aws secretsmanager get-secret-value \
  --secret-id ordr-connect/staging/redis-auth-token \
  --query SecretString --output text)

kubectl create secret generic api-secrets \
  --namespace=ordr-staging \
  --from-literal=DATABASE_PASSWORD="$RDS_PASSWORD" \
  --from-literal=REDIS_AUTH_TOKEN="$REDIS_TOKEN" \
  --from-literal=JWT_ACCESS_SECRET="$(openssl rand -base64 64)" \
  --from-literal=JWT_REFRESH_SECRET="$(openssl rand -base64 64)" \
  --from-literal=SESSION_SECRET="$(openssl rand -base64 64)" \
  --from-literal=HMAC_SECRET="$(openssl rand -base64 64)" \
  --dry-run=client -o yaml | kubectl apply -f -
```

- [ ] **Step 4: Verify ConfigMap and Secret exist**

```bash
kubectl get configmap api-config -n ordr-staging
kubectl get secret api-secrets -n ordr-staging
```

Expected: Both resources exist. Secret data should show `<number> bytes` (not plaintext).

- [ ] **Step 5: Commit .gitignore update**

```bash
git add .gitignore
git commit -m "chore: gitignore staging k8s config and secret overlay files"
```

---

## Chunk 4: GitHub Actions Wiring + First Deploy

### Task 7: Configure GitHub Actions secrets for staging

**Prerequisites:** `gh auth status` must show authenticated with repo admin permissions.

- [ ] **Step 1: Generate the STAGING_KUBECONFIG value**

```bash
# Export the staging cluster kubeconfig as base64
KUBECONFIG_B64=$(kubectl config view --minify --flatten \
  --context=staging | base64 -w 0)
echo "STAGING_KUBECONFIG length: ${#KUBECONFIG_B64} chars"
```

- [ ] **Step 2: Get the STAGING_URL**

```bash
# Get the external hostname from the API ingress
STAGING_URL=$(kubectl get ingress -n ordr-staging \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].hostname}')
echo "https://$STAGING_URL"
```

If the ingress hostname isn't ready yet (LoadBalancer pending), wait 2–5 minutes and retry.

- [ ] **Step 3: Set GitHub Actions secrets**

```bash
gh secret set STAGING_KUBECONFIG --body "$KUBECONFIG_B64"
gh secret set STAGING_URL --body "https://$STAGING_URL"
```

For Slack (if you have a webhook URL):
```bash
gh secret set SLACK_WEBHOOK_URL --body "<your-slack-webhook-url>"
```

- [ ] **Step 4: Verify secrets are set (names only — values are never shown)**

```bash
gh secret list
```

Expected to see: `STAGING_KUBECONFIG`, `STAGING_URL`, `SLACK_WEBHOOK_URL`

---

### Task 8: Fix deploy-staging.yml — missing Dockerfile target and namespace

Two issues in the current `deploy-staging.yml`:

1. Line 66 uses `file: ./infrastructure/docker/Dockerfile` (the deprecated one). Should use `Dockerfile.api`.
2. Line 93 deploys only the API — worker, web, agent-runtime need their own image builds or the workflow needs updating.

For Phase 50, we fix issue 1 (broken build) and note issue 2 as a follow-up.

**Files:**
- Modify: `.github/workflows/deploy-staging.yml:66`

- [ ] **Step 1: Write a CI workflow test**

Check that the workflow references the correct Dockerfile:

```bash
# tests/compliance/check-deploy-staging-dockerfile.sh
#!/bin/bash
set -e
DOCKERFILE=$(grep 'file:' .github/workflows/deploy-staging.yml | grep -oP 'Dockerfile\.\w+')
if [ "$DOCKERFILE" != "Dockerfile.api" ]; then
  echo "ERROR: deploy-staging.yml references '$DOCKERFILE', expected 'Dockerfile.api'"
  exit 1
fi
echo "PASS: deploy-staging.yml references Dockerfile.api"
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
bash tests/compliance/check-deploy-staging-dockerfile.sh
```

Expected: `ERROR: deploy-staging.yml references 'Dockerfile', expected 'Dockerfile.api'`

- [ ] **Step 3: Fix the Dockerfile reference**

In `.github/workflows/deploy-staging.yml`, change line 66:

```yaml
# BEFORE
          file: ./infrastructure/docker/Dockerfile

# AFTER
          file: ./infrastructure/docker/Dockerfile.api
```

- [ ] **Step 4: Run the test again**

```bash
bash tests/compliance/check-deploy-staging-dockerfile.sh
```

Expected: `PASS: deploy-staging.yml references Dockerfile.api`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/deploy-staging.yml \
        tests/compliance/check-deploy-staging-dockerfile.sh
git commit -m "fix(ci): deploy-staging.yml — use Dockerfile.api not deprecated Dockerfile"
```

---

### Task 9: Trigger first staging deploy

- [ ] **Step 1: Push current main to develop to trigger the pipeline**

```bash
git checkout -b develop 2>/dev/null || git checkout develop
git merge main
git push origin develop
```

- [ ] **Step 2: Watch the pipeline**

```bash
gh run watch --repo $(gh repo view --json nameWithOwner -q .nameWithOwner)
```

Or open the Actions tab in GitHub. The pipeline should progress through: CI → Build & Push → Deploy to Staging → Notify.

Expected total time: 8–15 minutes.

- [ ] **Step 3: Verify pods are running with the new image**

```bash
kubectl get pods -n ordr-staging
kubectl describe deployment ordr-connect-api -n ordr-staging | grep Image
```

Expected: pods in `Running` state, image tag contains the commit SHA.

---

### Task 10: Smoke tests and verification

- [ ] **Step 1: Run the smoke test manually**

```bash
STAGING_URL=$(gh secret list | grep STAGING_URL)
# Retrieve the actual URL from the secret (set it as env var yourself):
curl -sf "https://<your-staging-url>/health/live" | jq .
curl -sf "https://<your-staging-url>/health/ready" | jq .
```

Expected: `{"status":"ok"}` or equivalent JSON health response.

- [ ] **Step 2: Check audit logging is working**

```bash
kubectl logs -n ordr-staging \
  -l app=api \
  --tail=50 | grep '"type":"audit"'
```

Expected: Audit log lines for incoming requests.

- [ ] **Step 3: Verify RLS is enforced (multi-tenant isolation)**

```bash
# Connect to staging RDS via bastion or port-forward through kubectl
# Run a query without setting app.current_tenant:
kubectl exec -n ordr-staging deployment/ordr-connect-api -- \
  node -e "
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    pool.query('SELECT count(*) FROM tenants').then(r => console.log(r.rows)).catch(e => console.error(e.message));
  "
```

Expected: Should return count OR throw a permission error depending on RLS policy — confirm it doesn't expose cross-tenant data.

- [ ] **Step 4: Update project memory with staging status**

After verifying the deployment works, update the MEMORY.md entry for project-status.md to reflect Phase 50 complete.

- [ ] **Step 5: Commit final test results and push**

```bash
git add tests/
git commit -m "test(compliance): add namespace + dockerfile CI consistency checks"
git push origin develop
git checkout main
git merge develop
git push origin main
```

---

## Known Follow-ups (not in scope for Phase 50)

| Item | Phase |
|------|-------|
| Wire worker, web, agent-runtime image builds into deploy-staging.yml | Phase 50b |
| Secret rotation operational (Vault leases + auto-renew schedules) | Phase 55 |
| WAF integration (AWS WAF rules via Terraform) | Phase 54 |
| GDPR DSR data export endpoint | Phase 51 |

---

## Rollback Procedure

If `terraform apply` fails partway through:
```bash
terraform destroy -target=module.ordr_connect.module.eks
# or full destroy:
terraform destroy
```

If Kubernetes deploy fails:
```bash
kubectl rollout undo deployment/ordr-connect-api -n ordr-staging
```

If CI pipeline breaks `develop`:
```bash
git revert HEAD
git push origin develop
```
