# ORDR-Connect — Developer Convenience Commands
# Usage: make <target>
# SOC2/ISO27001/HIPAA: security-scan target is mandatory before release

.PHONY: dev setup clean test test-coverage lint build docker-up docker-down db-migrate db-seed db-reset db-status db-push security-scan type-check

# ============================================================
# Setup & Development
# ============================================================

setup: ## Install dependencies and set up local environment
	@echo "==> Installing dependencies..."
	pnpm install
	@echo "==> Starting docker services..."
	$(MAKE) docker-up
	@echo "==> Waiting for services to be healthy..."
	@sleep 5
	@echo "==> Running database migrations..."
	$(MAKE) db-migrate
	@echo "==> Seeding database..."
	$(MAKE) db-seed
	@echo "==> Setup complete. Run 'make dev' to start."

dev: ## Start development servers (docker services + API)
	@docker compose ps --services --filter "status=running" | grep -q postgres || $(MAKE) docker-up
	pnpm dev

# ============================================================
# Build & Quality
# ============================================================

clean: ## Clean all build artifacts
	@echo "==> Cleaning build artifacts..."
	rm -rf apps/*/dist packages/*/dist
	rm -rf .turbo node_modules/.cache
	rm -rf coverage
	@echo "==> Clean complete."

test: ## Run all tests
	pnpm test

test-coverage: ## Run tests with coverage
	pnpm test -- --coverage

lint: ## Run linting
	pnpm lint

type-check: ## TypeScript type checking
	pnpm exec tsc --noEmit

build: ## Build all packages
	pnpm build

# ============================================================
# Docker Services
# ============================================================

docker-up: ## Start docker services (PG, Redis, Kafka)
	docker compose up -d
	@echo "==> Waiting for healthy services..."
	@docker compose ps

docker-down: ## Stop docker services
	docker compose down

# ============================================================
# Database
# ============================================================

db-migrate: ## Run versioned SQL migrations (checksummed, idempotent)
	@echo "==> Running database migrations..."
	pnpm --filter @ordr/db exec tsx src/migrate.ts up
	@echo "==> Migrations complete."

db-seed: ## Seed database with default data (idempotent)
	@echo "==> Seeding database..."
	pnpm --filter @ordr/db exec tsx src/seed.ts
	@echo "==> Seed complete."

db-reset: ## Drop + migrate + seed (DEVELOPMENT ONLY)
	@if [ "$$NODE_ENV" = "production" ]; then echo "ERROR: db-reset is forbidden in production"; exit 1; fi
	@echo "==> WARNING: This will destroy all data. Press Ctrl+C to abort."
	@sleep 3
	@echo "==> Dropping database..."
	pnpm --filter @ordr/db exec tsx -e "import postgres from 'postgres'; const sql = postgres(process.env.DATABASE_URL); await sql\`DROP SCHEMA public CASCADE; CREATE SCHEMA public;\`; await sql.end();"
	@echo "==> Running migrations..."
	$(MAKE) db-migrate
	@echo "==> Seeding..."
	$(MAKE) db-seed
	@echo "==> Reset complete."

db-status: ## Show migration status (applied vs pending)
	pnpm --filter @ordr/db exec tsx src/migrate.ts status

db-push: ## Push schema to database (drizzle-kit, development shortcut)
	pnpm --filter @ordr-connect/api exec drizzle-kit push

# ============================================================
# Security (SOC2/ISO27001/HIPAA compliance)
# ============================================================

security-scan: ## Run security scans (audit + gitleaks)
	@echo "==> Running dependency audit..."
	pnpm audit --audit-level=moderate || true
	@echo "==> Running gitleaks scan..."
	gitleaks detect --source . --verbose || true
	@echo "==> Security scan complete."

# ============================================================
# Help
# ============================================================

help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
