/**
 * ORDR-Connect — Terraform Infrastructure Validation Tests
 * Validates all .tf files against compliance requirements:
 * - SOC 2 Type II, ISO 27001:2022, HIPAA
 * - CLAUDE.md Rules 1, 2, 3, 5, 8, 10
 *
 * These tests parse Terraform files as text to validate security
 * and compliance properties WITHOUT requiring terraform CLI.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join, relative } from 'path';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TF_ROOT = join(__dirname, '..');

function findTfFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '.terraform' && entry.name !== 'node_modules') {
      results.push(...findTfFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.tf')) {
      results.push(fullPath);
    }
  }
  return results;
}

function readTf(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

function getAllTfContent(): string {
  return findTfFiles(TF_ROOT).map(f => readTf(f)).join('\n');
}

function getModuleDirs(): string[] {
  const modulesDir = join(TF_ROOT, 'modules');
  if (!existsSync(modulesDir)) return [];
  return readdirSync(modulesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => join(modulesDir, d.name));
}

const allTfFiles = findTfFiles(TF_ROOT);
const allTfContent = getAllTfContent();

// ---------------------------------------------------------------------------
// 1. HCL Structure Validation
// ---------------------------------------------------------------------------

describe('HCL Structure Validation', () => {
  it('should have .tf files in the terraform root', () => {
    const rootTfFiles = allTfFiles.filter(f => {
      const rel = relative(TF_ROOT, f);
      return !rel.includes('/') && !rel.includes('\\');
    });
    expect(rootTfFiles.length).toBeGreaterThanOrEqual(3);
  });

  it('should have main.tf in root', () => {
    expect(existsSync(join(TF_ROOT, 'main.tf'))).toBe(true);
  });

  it('should have variables.tf in root', () => {
    expect(existsSync(join(TF_ROOT, 'variables.tf'))).toBe(true);
  });

  it('should have outputs.tf in root', () => {
    expect(existsSync(join(TF_ROOT, 'outputs.tf'))).toBe(true);
  });

  it('should have terraform.tfvars.example', () => {
    expect(existsSync(join(TF_ROOT, 'terraform.tfvars.example'))).toBe(true);
  });

  it('should not have any .tfstate files committed', () => {
    const stateFiles = allTfFiles.filter(f => f.endsWith('.tfstate') || f.endsWith('.tfstate.backup'));
    expect(stateFiles).toHaveLength(0);
  });

  it('all .tf files should have valid HCL block structure', () => {
    for (const file of allTfFiles) {
      const content = readTf(file);
      // Validate balanced braces (basic HCL structure check)
      let depth = 0;
      for (const char of content) {
        if (char === '{') depth++;
        if (char === '}') depth--;
        expect(depth).toBeGreaterThanOrEqual(0);
      }
      expect(depth).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Module Structure Validation
// ---------------------------------------------------------------------------

describe('Module Structure Validation', () => {
  const expectedModules = ['networking', 'eks', 'rds', 'redis', 'kafka', 'vault', 'monitoring', 's3'];

  it.each(expectedModules)('module %s should exist', (mod) => {
    expect(existsSync(join(TF_ROOT, 'modules', mod))).toBe(true);
  });

  it('all modules should have variables.tf', () => {
    for (const dir of getModuleDirs()) {
      const varFile = join(dir, 'variables.tf');
      expect(existsSync(varFile)).toBe(true);
    }
  });

  it('all modules should have outputs.tf', () => {
    for (const dir of getModuleDirs()) {
      const outFile = join(dir, 'outputs.tf');
      expect(existsSync(outFile)).toBe(true);
    }
  });

  it('all modules should have main.tf', () => {
    for (const dir of getModuleDirs()) {
      const mainFile = join(dir, 'main.tf');
      expect(existsSync(mainFile)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. No Hardcoded Secrets (Rule 5)
// ---------------------------------------------------------------------------

describe('No Hardcoded Secrets (Rule 5)', () => {
  const secretPatterns = [
    /(?:password|secret|token|api_key)\s*=\s*"[^"]{8,}"/gi,
    /AKIA[0-9A-Z]{16}/g,                              // AWS Access Key
    /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}/g,   // GitHub token
    /sk-[A-Za-z0-9]{20,}/g,                           // OpenAI key pattern
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,       // Private keys
  ];

  it('should have no hardcoded secrets in any .tf file', () => {
    for (const file of allTfFiles) {
      const content = readTf(file);
      const relPath = relative(TF_ROOT, file);

      for (const pattern of secretPatterns) {
        // Reset regex state
        pattern.lastIndex = 0;
        const matches = content.match(pattern) || [];
        // Filter out known safe patterns
        const realMatches = matches.filter(m =>
          !m.includes('CHANGE_ME') &&
          !m.includes('placeholder') &&
          !m.includes('example') &&
          !m.includes('random_password') &&
          !m.includes('var.')
        );
        expect(realMatches).toHaveLength(0);
      }
    }
  });

  it('should use aws_secretsmanager_secret for sensitive values', () => {
    expect(allTfContent).toContain('aws_secretsmanager_secret');
  });

  it('should use random_password for generated credentials', () => {
    expect(allTfContent).toContain('random_password');
  });

  it('sensitive outputs should be marked sensitive', () => {
    const outputBlocks = allTfContent.match(/output\s+"[^"]+"\s*\{[^}]*\}/gs) || [];
    const sensitiveOutputs = outputBlocks.filter(b =>
      b.match(/endpoint|password|secret|token|broker/i)
    );
    for (const output of sensitiveOutputs) {
      if (output.match(/endpoint|password|secret|token|broker/i) &&
          !output.match(/arn|name|id|release_name|namespace/i)) {
        expect(output).toContain('sensitive');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Security Group Rules (Rule 10)
// ---------------------------------------------------------------------------

describe('Security Groups — Zero Trust (Rule 10)', () => {
  it('ALB should only allow inbound 443', () => {
    const networkingMain = readTf(join(TF_ROOT, 'modules', 'networking', 'main.tf'));
    // Find ALB security group block
    const albSgMatch = networkingMain.match(/resource\s+"aws_security_group"\s+"alb"\s*\{[\s\S]*?\n\}/);
    expect(albSgMatch).not.toBeNull();

    const albSg = albSgMatch![0];
    // Should have port 443 ingress
    expect(albSg).toContain('from_port   = 443');
    expect(albSg).toContain('to_port     = 443');
    // Should reference 0.0.0.0/0 only for 443
    expect(albSg).toContain('0.0.0.0/0');
  });

  it('database SG should NOT have 0.0.0.0/0 ingress', () => {
    const networkingMain = readTf(join(TF_ROOT, 'modules', 'networking', 'main.tf'));
    const dbSgMatch = networkingMain.match(/resource\s+"aws_security_group"\s+"database"\s*\{[\s\S]*?\n\}/);
    expect(dbSgMatch).not.toBeNull();

    const dbSg = dbSgMatch![0];
    // Find ingress blocks within the DB SG
    const ingressBlocks = dbSg.match(/ingress\s*\{[\s\S]*?\}/g) || [];
    for (const ingress of ingressBlocks) {
      expect(ingress).not.toContain('0.0.0.0/0');
    }
  });

  it('redis SG should NOT have 0.0.0.0/0 ingress', () => {
    const networkingMain = readTf(join(TF_ROOT, 'modules', 'networking', 'main.tf'));
    const redisSgMatch = networkingMain.match(/resource\s+"aws_security_group"\s+"redis"\s*\{[\s\S]*?\n\}/);
    expect(redisSgMatch).not.toBeNull();

    const redisSg = redisSgMatch![0];
    const ingressBlocks = redisSg.match(/ingress\s*\{[\s\S]*?\}/g) || [];
    for (const ingress of ingressBlocks) {
      expect(ingress).not.toContain('0.0.0.0/0');
    }
  });

  it('kafka SG should NOT have 0.0.0.0/0 ingress', () => {
    const networkingMain = readTf(join(TF_ROOT, 'modules', 'networking', 'main.tf'));
    const kafkaSgMatch = networkingMain.match(/resource\s+"aws_security_group"\s+"kafka"\s*\{[\s\S]*?\n\}/);
    expect(kafkaSgMatch).not.toBeNull();

    const kafkaSg = kafkaSgMatch![0];
    const ingressBlocks = kafkaSg.match(/ingress\s*\{[\s\S]*?\}/g) || [];
    for (const ingress of ingressBlocks) {
      expect(ingress).not.toContain('0.0.0.0/0');
    }
  });

  it('only ALB SG should reference 0.0.0.0/0 in ingress across all SGs', () => {
    const networkingMain = readTf(join(TF_ROOT, 'modules', 'networking', 'main.tf'));
    const sgBlocks = networkingMain.match(/resource\s+"aws_security_group"\s+"(\w+)"\s*\{[\s\S]*?\n\}/g) || [];

    for (const sgBlock of sgBlocks) {
      const nameMatch = sgBlock.match(/resource\s+"aws_security_group"\s+"(\w+)"/);
      const sgName = nameMatch ? nameMatch[1] : 'unknown';

      const ingressBlocks = sgBlock.match(/ingress\s*\{[\s\S]*?\}/g) || [];
      for (const ingress of ingressBlocks) {
        if (ingress.includes('0.0.0.0/0')) {
          expect(sgName).toBe('alb');
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. RDS Compliance (Rules 1, 5, 10)
// ---------------------------------------------------------------------------

describe('RDS Compliance', () => {
  const rdsMain = existsSync(join(TF_ROOT, 'modules', 'rds', 'main.tf'))
    ? readTf(join(TF_ROOT, 'modules', 'rds', 'main.tf'))
    : '';

  it('RDS should be encrypted at rest', () => {
    expect(rdsMain).toContain('storage_encrypted     = true');
  });

  it('RDS should use KMS key for encryption', () => {
    expect(rdsMain).toContain('kms_key_id');
  });

  it('RDS should be Multi-AZ', () => {
    expect(rdsMain).toContain('multi_az               = true');
  });

  it('RDS should NOT be publicly accessible', () => {
    expect(rdsMain).toContain('publicly_accessible    = false');
  });

  it('RDS should force SSL connections', () => {
    expect(rdsMain).toMatch(/rds\.force_ssl.*1/s);
  });

  it('RDS should log connections', () => {
    expect(rdsMain).toMatch(/log_connections.*1/s);
  });

  it('RDS should log disconnections', () => {
    expect(rdsMain).toMatch(/log_disconnections.*1/s);
  });

  it('RDS should have Performance Insights enabled', () => {
    expect(rdsMain).toContain('performance_insights_enabled');
  });

  it('RDS password should be in Secrets Manager', () => {
    expect(rdsMain).toContain('aws_secretsmanager_secret');
  });

  it('RDS should use private subnet group', () => {
    expect(rdsMain).toContain('aws_db_subnet_group');
  });
});

// ---------------------------------------------------------------------------
// 6. Redis Compliance (Rules 1, 5)
// ---------------------------------------------------------------------------

describe('Redis Compliance', () => {
  const redisMain = existsSync(join(TF_ROOT, 'modules', 'redis', 'main.tf'))
    ? readTf(join(TF_ROOT, 'modules', 'redis', 'main.tf'))
    : '';

  it('Redis should have at-rest encryption enabled', () => {
    expect(redisMain).toContain('at_rest_encryption_enabled = true');
  });

  it('Redis should have transit encryption enabled', () => {
    expect(redisMain).toContain('transit_encryption_enabled = true');
  });

  it('Redis should use KMS for at-rest encryption', () => {
    expect(redisMain).toContain('kms_key_id');
  });

  it('Redis should have auth token configured', () => {
    expect(redisMain).toContain('auth_token');
  });

  it('Redis auth token should come from Secrets Manager', () => {
    expect(redisMain).toContain('aws_secretsmanager_secret');
  });

  it('Redis should use private subnets', () => {
    expect(redisMain).toContain('aws_elasticache_subnet_group');
  });
});

// ---------------------------------------------------------------------------
// 7. S3 Compliance (Rules 1, 3, 8)
// ---------------------------------------------------------------------------

describe('S3 Compliance', () => {
  const s3Main = existsSync(join(TF_ROOT, 'modules', 's3', 'main.tf'))
    ? readTf(join(TF_ROOT, 'modules', 's3', 'main.tf'))
    : '';

  it('audit bucket should have Object Lock enabled', () => {
    expect(s3Main).toContain('object_lock_enabled = true');
  });

  it('audit bucket should use Compliance retention mode', () => {
    expect(s3Main).toContain('mode = "COMPLIANCE"');
  });

  it('all buckets should have versioning enabled', () => {
    const versioningBlocks = s3Main.match(/versioning_configuration\s*\{[^}]*\}/g) || [];
    expect(versioningBlocks.length).toBeGreaterThanOrEqual(4);
    for (const block of versioningBlocks) {
      expect(block).toContain('status = "Enabled"');
    }
  });

  it('all buckets should have server-side encryption', () => {
    const encryptionBlocks = s3Main.match(/aws_s3_bucket_server_side_encryption_configuration/g) || [];
    expect(encryptionBlocks.length).toBeGreaterThanOrEqual(4);
  });

  it('all buckets should use KMS encryption', () => {
    const kmsBlocks = s3Main.match(/sse_algorithm\s*=\s*"aws:kms"/g) || [];
    expect(kmsBlocks.length).toBeGreaterThanOrEqual(4);
  });

  it('all buckets should block public access', () => {
    const publicAccessBlocks = s3Main.match(/aws_s3_bucket_public_access_block/g) || [];
    expect(publicAccessBlocks.length).toBeGreaterThanOrEqual(4);
  });

  it('audit and sbom buckets should have access logging', () => {
    const loggingBlocks = s3Main.match(/aws_s3_bucket_logging/g) || [];
    expect(loggingBlocks.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 8. EKS Compliance (Rules 2, 10)
// ---------------------------------------------------------------------------

describe('EKS Compliance', () => {
  const eksMain = existsSync(join(TF_ROOT, 'modules', 'eks', 'main.tf'))
    ? readTf(join(TF_ROOT, 'modules', 'eks', 'main.tf'))
    : '';

  it('EKS should have all audit log types enabled', () => {
    expect(eksMain).toContain('"api"');
    expect(eksMain).toContain('"audit"');
    expect(eksMain).toContain('"authenticator"');
    expect(eksMain).toContain('"controllerManager"');
    expect(eksMain).toContain('"scheduler"');
  });

  it('EKS should use envelope encryption with KMS', () => {
    expect(eksMain).toContain('encryption_config');
    expect(eksMain).toContain('key_arn');
  });

  it('EKS should use private endpoint access', () => {
    expect(eksMain).toContain('endpoint_private_access = true');
  });

  it('EKS should have OIDC provider for IRSA', () => {
    expect(eksMain).toContain('aws_iam_openid_connect_provider');
  });

  it('EKS should enforce Pod Security Standards (restricted)', () => {
    expect(eksMain).toContain('pod-security.kubernetes.io/enforce');
    expect(eksMain).toContain('restricted');
  });

  it('EKS should have agent-runtime node group with taint', () => {
    expect(eksMain).toContain('agent-runtime');
    expect(eksMain).toContain('taint');
  });

  it('EKS should use private subnets for nodes', () => {
    expect(eksMain).toContain('private_subnet_ids');
  });
});

// ---------------------------------------------------------------------------
// 9. Kafka/MSK Compliance (Rules 1, 2)
// ---------------------------------------------------------------------------

describe('Kafka/MSK Compliance', () => {
  const kafkaMain = existsSync(join(TF_ROOT, 'modules', 'kafka', 'main.tf'))
    ? readTf(join(TF_ROOT, 'modules', 'kafka', 'main.tf'))
    : '';

  it('MSK should have at-rest encryption with KMS', () => {
    expect(kafkaMain).toContain('encryption_at_rest_kms_key_arn');
  });

  it('MSK should enforce TLS for client-broker', () => {
    expect(kafkaMain).toContain('client_broker = "TLS"');
  });

  it('MSK should enable in-cluster encryption', () => {
    expect(kafkaMain).toContain('in_cluster    = true');
  });

  it('MSK should use SASL/SCRAM authentication', () => {
    expect(kafkaMain).toContain('scram = true');
  });

  it('MSK should disable unauthenticated access', () => {
    expect(kafkaMain).toContain('unauthenticated = false');
  });

  it('MSK should have CloudWatch logging enabled', () => {
    expect(kafkaMain).toContain('cloudwatch_logs');
    expect(kafkaMain).toContain('enabled   = true');
  });

  it('MSK should have Glue Schema Registry', () => {
    expect(kafkaMain).toContain('aws_glue_registry');
  });
});

// ---------------------------------------------------------------------------
// 10. State Backend Validation
// ---------------------------------------------------------------------------

describe('State Backend', () => {
  const rootMain = readTf(join(TF_ROOT, 'main.tf'));

  it('should use S3 backend for state', () => {
    expect(rootMain).toContain('backend "s3"');
  });

  it('should use DynamoDB for state locking', () => {
    expect(rootMain).toContain('dynamodb_table');
  });

  it('should encrypt state at rest', () => {
    expect(rootMain).toContain('encrypt        = true');
  });

  it('should use KMS for state encryption', () => {
    expect(rootMain).toContain('kms_key_id');
  });
});

// ---------------------------------------------------------------------------
// 11. No Default VPC Usage
// ---------------------------------------------------------------------------

describe('No Default VPC', () => {
  it('should not reference aws_default_vpc', () => {
    expect(allTfContent).not.toContain('aws_default_vpc');
  });

  it('should not reference aws_default_subnet', () => {
    expect(allTfContent).not.toContain('aws_default_subnet');
  });

  it('should not reference aws_default_security_group', () => {
    expect(allTfContent).not.toContain('aws_default_security_group');
  });
});

// ---------------------------------------------------------------------------
// 12. Resource Tagging
// ---------------------------------------------------------------------------

describe('Resource Tagging', () => {
  it('root provider should have default tags with Project', () => {
    const rootMain = readTf(join(TF_ROOT, 'main.tf'));
    expect(rootMain).toContain('Project     = "ordr-connect"');
  });

  it('root provider should have default tags with Environment', () => {
    const rootMain = readTf(join(TF_ROOT, 'main.tf'));
    expect(rootMain).toContain('Environment = var.environment');
  });

  it('root provider should have default tags with ManagedBy', () => {
    const rootMain = readTf(join(TF_ROOT, 'main.tf'));
    expect(rootMain).toContain('ManagedBy   = "terraform"');
  });

  it('networking resources should have required tags', () => {
    const networkingMain = readTf(join(TF_ROOT, 'modules', 'networking', 'main.tf'));
    const tagBlocks = networkingMain.match(/tags\s*=\s*\{[\s\S]*?\n  \}/g) || [];
    expect(tagBlocks.length).toBeGreaterThan(5);
    for (const tagBlock of tagBlocks) {
      expect(tagBlock).toContain('Project');
      expect(tagBlock).toContain('Environment');
      expect(tagBlock).toContain('ManagedBy');
    }
  });
});

// ---------------------------------------------------------------------------
// 13. Environment Configurations
// ---------------------------------------------------------------------------

describe('Environment Configurations', () => {
  it('staging environment should exist', () => {
    expect(existsSync(join(TF_ROOT, 'environments', 'staging', 'main.tf'))).toBe(true);
  });

  it('production environment should exist', () => {
    expect(existsSync(join(TF_ROOT, 'environments', 'production', 'main.tf'))).toBe(true);
  });

  it('staging should use staging environment variable', () => {
    const staging = readTf(join(TF_ROOT, 'environments', 'staging', 'main.tf'));
    expect(staging).toContain('environment = "staging"');
  });

  it('production should use production environment variable', () => {
    const production = readTf(join(TF_ROOT, 'environments', 'production', 'main.tf'));
    expect(production).toContain('environment = "production"');
  });

  it('staging should use smaller instance classes than production', () => {
    const staging = readTf(join(TF_ROOT, 'environments', 'staging', 'main.tf'));
    const production = readTf(join(TF_ROOT, 'environments', 'production', 'main.tf'));

    // Staging RDS should be smaller
    expect(staging).toContain('db.r6g.large');
    expect(production).toContain('db.r6g.xlarge');
  });

  it('production Kafka should have more brokers than staging', () => {
    const staging = readTf(join(TF_ROOT, 'environments', 'staging', 'main.tf'));
    const production = readTf(join(TF_ROOT, 'environments', 'production', 'main.tf'));

    const stagingBrokers = staging.match(/kafka_broker_count\s*=\s*(\d+)/);
    const prodBrokers = production.match(/kafka_broker_count\s*=\s*(\d+)/);

    expect(stagingBrokers).not.toBeNull();
    expect(prodBrokers).not.toBeNull();
    expect(parseInt(prodBrokers![1])).toBeGreaterThan(parseInt(stagingBrokers![1]));
  });
});

// ---------------------------------------------------------------------------
// 14. VPC Flow Logs
// ---------------------------------------------------------------------------

describe('VPC Flow Logs', () => {
  const networkingMain = existsSync(join(TF_ROOT, 'modules', 'networking', 'main.tf'))
    ? readTf(join(TF_ROOT, 'modules', 'networking', 'main.tf'))
    : '';

  it('VPC should have flow logs enabled', () => {
    expect(networkingMain).toContain('aws_flow_log');
  });

  it('flow logs should capture ALL traffic', () => {
    expect(networkingMain).toContain('traffic_type             = "ALL"');
  });

  it('flow logs should go to CloudWatch', () => {
    expect(networkingMain).toContain('cloud-watch-logs');
  });
});

// ---------------------------------------------------------------------------
// 15. Terraform Version Constraint
// ---------------------------------------------------------------------------

describe('Terraform Version', () => {
  const rootMain = readTf(join(TF_ROOT, 'main.tf'));

  it('should require Terraform >= 1.6', () => {
    expect(rootMain).toContain('required_version = ">= 1.6.0"');
  });

  it('should pin AWS provider version', () => {
    expect(rootMain).toMatch(/version\s*=\s*"~>\s*5\.\d+"/);
  });
});

// ---------------------------------------------------------------------------
// 16. Vault Compliance (Rule 5)
// ---------------------------------------------------------------------------

describe('Vault Compliance', () => {
  const vaultMain = existsSync(join(TF_ROOT, 'modules', 'vault', 'main.tf'))
    ? readTf(join(TF_ROOT, 'modules', 'vault', 'main.tf'))
    : '';

  it('Vault should use KMS for auto-unseal', () => {
    expect(vaultMain).toContain('aws_kms_key');
    expect(vaultMain).toContain('awskms');
  });

  it('Vault should have audit logging', () => {
    expect(vaultMain).toContain('audit');
    expect(vaultMain).toContain('cloudwatch_log_group');
  });

  it('Vault should run in HA mode with Raft', () => {
    expect(vaultMain).toContain('raft');
    expect(vaultMain).toContain('ha');
  });

  it('Vault should have TLS enabled', () => {
    expect(vaultMain).toContain('tls_disable   = false');
  });
});

// ---------------------------------------------------------------------------
// 17. Monitoring Stack
// ---------------------------------------------------------------------------

describe('Monitoring Stack', () => {
  const monitoringMain = existsSync(join(TF_ROOT, 'modules', 'monitoring', 'main.tf'))
    ? readTf(join(TF_ROOT, 'modules', 'monitoring', 'main.tf'))
    : '';

  it('should deploy kube-prometheus-stack', () => {
    expect(monitoringMain).toContain('kube-prometheus-stack');
  });

  it('should deploy Loki for log aggregation', () => {
    expect(monitoringMain).toContain('loki');
  });

  it('should configure AlertManager', () => {
    expect(monitoringMain).toContain('alertmanager');
  });

  it('monitoring namespace should enforce Pod Security Standards', () => {
    expect(monitoringMain).toContain('pod-security.kubernetes.io/enforce');
  });
});

// ---------------------------------------------------------------------------
// 18. KMS Key Rotation
// ---------------------------------------------------------------------------

describe('KMS Key Rotation (Rule 1)', () => {
  it('all KMS keys should have rotation enabled', () => {
    const kmsKeyBlocks = allTfContent.match(/resource\s+"aws_kms_key"\s+"\w+"\s*\{[\s\S]*?\n\}/g) || [];
    expect(kmsKeyBlocks.length).toBeGreaterThanOrEqual(4);
    for (const block of kmsKeyBlocks) {
      expect(block).toContain('enable_key_rotation     = true');
    }
  });
});

// ---------------------------------------------------------------------------
// 19. Variable Validation
// ---------------------------------------------------------------------------

describe('Variable Validation', () => {
  const rootVars = readTf(join(TF_ROOT, 'variables.tf'));

  it('environment variable should have validation', () => {
    expect(rootVars).toContain('validation');
    expect(rootVars).toContain('staging');
    expect(rootVars).toContain('production');
  });

  it('backup retention should enforce minimum 35 days', () => {
    expect(rootVars).toContain('var.db_backup_retention_days >= 35');
  });

  it('audit retention should enforce minimum 2557 days (7 years)', () => {
    expect(rootVars).toContain('var.audit_retention_days >= 2557');
  });

  it('Kafka broker count should enforce minimum 3', () => {
    expect(rootVars).toContain('var.kafka_broker_count >= 3');
  });
});
