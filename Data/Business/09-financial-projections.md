# ORDR-Connect — Financial Projections (5-Year)

> **Document Classification:** Confidential — Internal Strategy
> **Version:** 1.0
> **Last Updated:** 2026-03-24
> **Owner:** Synexiun Finance

---

## 1. Revenue Model Overview

ORDR-Connect generates revenue from three streams, each with different growth dynamics and margin profiles.

| Stream | Description | Margin Profile | Growth Driver |
|--------|-------------|---------------|---------------|
| **Platform Subscriptions** | Monthly per-team fees ($0–299/mo) | 85–90% gross margin | Customer acquisition, tier upgrades |
| **AI Consumption** | Per-interaction charges above tier inclusion | 65–75% gross margin | Usage growth, agent proliferation |
| **Communication Pass-Through** | Channel costs with 25–40% markup | 25–40% gross margin | Message volume, channel expansion |

**Revenue mix target at scale (Year 5):** 45% platform, 40% AI consumption, 15% pass-through.

---

## 2. Five-Year Revenue Projections

### Summary

| Metric | Year 1 | Year 2 | Year 3 | Year 4 | Year 5 |
|--------|--------|--------|--------|--------|--------|
| **Total Revenue** | $540K | $2.8M | $9.5M | $24M | $52M |
| Paying Customers (end of year) | 300 | 1,200 | 3,500 | 8,000 | 15,000 |
| Average Revenue per Customer (ARPC) /mo | $150 | $194 | $226 | $250 | $289 |
| MRR (end of year) | $75K | $310K | $990K | $2.4M | $5.1M |
| ARR (end of year) | $900K | $3.7M | $11.9M | $28.8M | $61.2M |
| YoY Growth | — | 419% | 239% | 153% | 117% |

### Revenue by Stream (Annual)

| Stream | Year 1 | Year 2 | Year 3 | Year 4 | Year 5 |
|--------|--------|--------|--------|--------|--------|
| Platform Subscriptions | $280K | $1.3M | $4.3M | $10.8M | $23.4M |
| AI Consumption | $180K | $1.1M | $3.8M | $9.6M | $20.8M |
| Communication Pass-Through | $80K | $400K | $1.4M | $3.6M | $7.8M |
| **Total** | **$540K** | **$2.8M** | **$9.5M** | **$24M** | **$52M** |

### Monthly Revenue Trajectory (Year 1 Detail)

| Month | Free Users | Paying Customers | MRR | Cumulative Revenue |
|-------|-----------|-----------------|-----|-------------------|
| 1 | 50 | 0 | $0 | $0 |
| 2 | 200 | 5 | $750 | $750 |
| 3 | 500 | 15 | $2,250 | $3,000 |
| 4 | 900 | 30 | $4,500 | $7,500 |
| 5 | 1,400 | 55 | $8,250 | $15,750 |
| 6 | 2,000 | 85 | $15,000 | $30,750 |
| 7 | 2,800 | 120 | $22,000 | $52,750 |
| 8 | 3,800 | 160 | $32,000 | $84,750 |
| 9 | 5,000 | 200 | $42,000 | $126,750 |
| 10 | 6,200 | 240 | $52,000 | $178,750 |
| 11 | 7,200 | 270 | $62,000 | $240,750 |
| 12 | 8,000 | 300 | $75,000 | $315,750 |

Note: Cumulative revenue ($540K annual) includes month-over-month ramp — early months contribute less than end-state MRR would suggest.

---

## 3. Cost Structure

### Cost Categories

| Category | Components | Year 1 | Year 2 | Year 3 | Year 4 | Year 5 |
|----------|-----------|--------|--------|--------|--------|--------|
| **People** | Engineering, sales, ops, leadership | $480K | $1.4M | $3.6M | $7.2M | $12M |
| **Infrastructure** | Cloud compute, databases, CDN, monitoring | $72K | $240K | $600K | $1.2M | $2.1M |
| **AI Inference** | LLM API costs (tiered routing) | $65K | $380K | $1.1M | $2.4M | $4.2M |
| **Communication** | Channel pass-through costs (Twilio, etc.) | $58K | $290K | $1.0M | $2.6M | $5.6M |
| **Sales & Marketing** | Content, ads, events, partnerships | $180K | $560K | $1.4M | $3.0M | $5.2M |
| **Compliance & Legal** | Audits, certifications, legal counsel | $60K | $120K | $240K | $400K | $600K |
| **General & Admin** | Office, insurance, accounting, tools | $36K | $80K | $160K | $320K | $520K |
| **Total Costs** | | **$951K** | **$3.07M** | **$8.1M** | **$17.1M** | **$30.2M** |

### AI Inference Cost Optimization

This is the single most important cost lever. ORDR-Connect's tiered model routing architecture is projected to reduce AI inference costs by 60–80% compared to single-model approaches.

| Routing Tier | Model Class | Cost/1K Tokens | % of Interactions | Use Case |
|-------------|------------|----------------|-------------------|----------|
| **Tier 1 — Fast** | Haiku-class | $0.00025 (in) / $0.00125 (out) | 60–70% | Routing, classification, simple FAQ |
| **Tier 2 — Balanced** | Sonnet-class | $0.003 (in) / $0.015 (out) | 25–30% | Standard responses, multi-step conversations |
| **Tier 3 — Frontier** | Opus-class | $0.015 (in) / $0.075 (out) | 3–5% | Complex reasoning, compliance review, escalation decisions |

**Blended cost per interaction (1,500 tokens avg):**

| Approach | Cost/Interaction | Monthly Cost (100K interactions) |
|----------|-----------------|--------------------------------|
| All Frontier | $0.068 | $6,800 |
| All Balanced | $0.014 | $1,400 |
| **ORDR Tiered Routing** | **$0.008** | **$800** |
| **Savings vs. Frontier** | **88%** | **$6,000/mo** |

As interaction volume scales, this optimization compounds. At Year 5 volumes (50M+ interactions/month), the savings exceed $3M annually.

### Infrastructure Cost Scaling

| Component | Year 1 | Year 2 | Year 3 | Year 4 | Year 5 |
|-----------|--------|--------|--------|--------|--------|
| Compute (Kubernetes) | $24K | $84K | $216K | $420K | $720K |
| Database (PostgreSQL + Redis) | $18K | $60K | $144K | $300K | $540K |
| Message queue (Kafka) | $12K | $36K | $84K | $168K | $300K |
| Storage & CDN | $6K | $24K | $60K | $120K | $216K |
| Monitoring & observability | $6K | $18K | $48K | $96K | $168K |
| Security tooling | $6K | $18K | $48K | $96K | $156K |
| **Total Infrastructure** | **$72K** | **$240K** | **$600K** | **$1.2M** | **$2.1M** |
| Infrastructure as % of revenue | 13.3% | 8.6% | 6.3% | 5.0% | 4.0% |

Infrastructure cost as a percentage of revenue declines each year — this is the SaaS scaling advantage. Target is under 5% by Year 4.

---

## 4. Unit Economics

### Blended Unit Economics by Year

| Metric | Year 1 | Year 2 | Year 3 | Year 4 | Year 5 |
|--------|--------|--------|--------|--------|--------|
| **ARPC (monthly)** | $150 | $194 | $226 | $250 | $289 |
| **Gross Margin** | 64% | 68% | 72% | 75% | 77% |
| **CAC (blended)** | $1,200 | $950 | $750 | $600 | $500 |
| **LTV (3-year)** | $4,320 | $5,650 | $7,040 | $8,100 | $9,580 |
| **LTV:CAC** | 3.6:1 | 5.9:1 | 9.4:1 | 13.5:1 | 19.2:1 |
| **Payback Period** | 8.0 mo | 5.6 mo | 3.8 mo | 2.8 mo | 2.2 mo |
| **Logo Churn (annual)** | 15% | 10% | 7% | 5% | 4% |
| **NRR** | 105% | 112% | 118% | 120% | 122% |

### CAC Breakdown by Channel

| Channel | Year 1 CAC | Year 3 CAC | Notes |
|---------|-----------|-----------|-------|
| PLG (self-serve) | $200 | $120 | Lowest CAC, highest volume |
| Content/SEO | $600 | $350 | Compounds over time |
| Paid search | $1,500 | $900 | Competitive keywords |
| Inside sales | $2,500 | $1,800 | Mid-market deals |
| Field sales (enterprise) | $25,000 | $18,000 | High ACV justifies high CAC |
| **Blended** | **$1,200** | **$750** | PLG mix increases over time |

### CAC Payback Analysis

| Segment | CAC | Monthly Gross Profit | Payback Period |
|---------|-----|---------------------|----------------|
| SMB (PLG) | $200 | $64 | 3.1 months |
| SMB (sales-assisted) | $800 | $96 | 8.3 months |
| Mid-market | $2,500 | $450 | 5.6 months |
| Enterprise | $25,000 | $5,500 | 4.5 months |

---

## 5. Headcount Plan

### Year-by-Year Headcount

| Function | Year 1 | Year 2 | Year 3 | Year 4 | Year 5 |
|----------|--------|--------|--------|--------|--------|
| **Engineering** | 3 | 8 | 18 | 32 | 50 |
| — Backend / Infrastructure | 1 | 3 | 7 | 12 | 18 |
| — Frontend / Product | 1 | 2 | 4 | 7 | 10 |
| — AI / ML | 1 | 2 | 4 | 7 | 12 |
| — DevOps / SRE | 0 | 1 | 3 | 6 | 10 |
| **Product** | 1 | 2 | 4 | 6 | 8 |
| **Sales** | 1 | 4 | 10 | 20 | 32 |
| — SDR | 0 | 2 | 4 | 8 | 12 |
| — AE | 1 | 1 | 4 | 8 | 12 |
| — SE | 0 | 1 | 2 | 4 | 8 |
| **Customer Success** | 0 | 2 | 5 | 10 | 16 |
| **Marketing** | 1 | 2 | 4 | 6 | 10 |
| **Compliance / Legal** | 0 | 1 | 2 | 3 | 4 |
| **Operations / Admin** | 0 | 1 | 2 | 3 | 5 |
| **Leadership** | 1 | 2 | 3 | 4 | 5 |
| **Total Headcount** | **7** | **22** | **48** | **84** | **130** |

### Compensation Assumptions

| Level | Average Total Comp (Base + Equity) | Notes |
|-------|-----------------------------------|-------|
| Junior engineer | $100K | Year 1–2 hires |
| Senior engineer | $160K | Year 2+ hires |
| Staff engineer | $220K | Year 3+ hires |
| Sales (AE, OTE) | $140K | 50/50 base/variable |
| Sales (SDR, OTE) | $80K | 60/40 base/variable |
| Marketing | $110K | Average across levels |
| Customer success | $90K | Average across levels |
| Leadership | $200K | Average, pre-equity |

### People Cost by Year

| Component | Year 1 | Year 2 | Year 3 | Year 4 | Year 5 |
|-----------|--------|--------|--------|--------|--------|
| Base compensation | $400K | $1.15M | $3.0M | $6.0M | $10.0M |
| Benefits (20% of base) | $80K | $230K | $600K | $1.2M | $2.0M |
| **Total People Cost** | **$480K** | **$1.38M** | **$3.6M** | **$7.2M** | **$12.0M** |

---

## 6. Profitability Path

### Operating Income Trajectory

| Metric | Year 1 | Year 2 | Year 3 | Year 4 | Year 5 |
|--------|--------|--------|--------|--------|--------|
| Revenue | $540K | $2.8M | $9.5M | $24M | $52M |
| Total Costs | $951K | $3.07M | $8.1M | $17.1M | $30.2M |
| **Operating Income** | **($411K)** | **($270K)** | **$1.4M** | **$6.9M** | **$21.8M** |
| **Operating Margin** | **-76%** | **-10%** | **15%** | **29%** | **42%** |
| Cumulative P&L | ($411K) | ($681K) | $719K | $7.6M | $29.4M |

### Key Milestones

| Milestone | Target Date | Conditions |
|-----------|------------|------------|
| First revenue | Month 2 | First paying customer on Growth tier |
| $10K MRR | Month 6 | 85 paying customers |
| $75K MRR | Month 12 | 300 paying customers |
| Cash flow break-even (monthly) | Month 18 | MRR covers monthly burn |
| Cumulative break-even | Month 28 | Cumulative revenue exceeds cumulative costs |
| $1M ARR | Month 14 | — |
| $10M ARR | Month 30 | — |
| $50M ARR | Month 54 | — |

---

## 7. Monthly Burn Rate

### Year 1 Monthly Burn

| Month | Revenue | Costs | Net Burn | Cumulative Burn |
|-------|---------|-------|----------|-----------------|
| 1 | $0 | $55K | ($55K) | ($55K) |
| 2 | $750 | $58K | ($57K) | ($112K) |
| 3 | $2,250 | $60K | ($58K) | ($170K) |
| 4 | $4,500 | $65K | ($61K) | ($231K) |
| 5 | $8,250 | $68K | ($60K) | ($291K) |
| 6 | $15,000 | $72K | ($57K) | ($348K) |
| 7 | $22,000 | $78K | ($56K) | ($404K) |
| 8 | $32,000 | $82K | ($50K) | ($454K) |
| 9 | $42,000 | $88K | ($46K) | ($500K) |
| 10 | $52,000 | $92K | ($40K) | ($540K) |
| 11 | $62,000 | $95K | ($33K) | ($573K) |
| 12 | $75,000 | $98K | ($23K) | ($596K) |

**Peak cumulative burn: ~$600K (end of Year 1).**

### Burn Rate by Phase

| Phase | Monthly Burn Range | Duration | Total Burn |
|-------|-------------------|----------|------------|
| Phase 0–1 (Build) | $55–65K | Months 1–4 | $235K |
| Phase 2 (Wedge) | $65–78K | Months 5–8 | $280K |
| Phase 3 (Expand) | $80–98K | Months 9–14 | $540K |
| Break-even transition | Declining to $0 | Months 15–18 | $120K |
| **Total pre-profitability burn** | | | **~$1.2M** |

---

## 8. Funding Requirements

### Phase-Based Funding

| Phase | Funding Needed | Use of Funds | Funding Type |
|-------|---------------|-------------|--------------|
| **Pre-Seed (Now)** | $0 (bootstrapped) | Architecture, MVP, first compliance cert | Founder capital + revenue |
| **Seed (Month 6–8)** | $1.5M | Engineering team (3→8), first sales hire, SOC 2 Type II audit, 18-month runway | Angel round or pre-seed VC |
| **Series A (Month 18–22)** | $8–12M | Scale engineering (22→48), sales team, multi-vertical expansion, international prep | Institutional VC |
| **Series B (Month 36–42)** | $25–40M | Enterprise sales, international expansion, platform ecosystem, agent marketplace | Growth equity |

### Capital Efficiency Metrics

| Metric | Target | Industry Benchmark |
|--------|--------|-------------------|
| Burn multiple (Year 1) | 1.8x | < 2.0x is efficient for pre-revenue |
| Burn multiple (Year 2) | 1.1x | < 1.5x is efficient for early revenue |
| Revenue per employee (Year 3) | $198K | $150–250K is healthy for B2B SaaS |
| Revenue per employee (Year 5) | $400K | Top-quartile B2B SaaS |
| ARR per $1 raised (Year 5) | $4.50+ | > $3.00 is capital efficient |

### Runway Analysis

| Scenario | Cash on Hand | Monthly Burn | Runway |
|----------|-------------|-------------|--------|
| Bootstrapped (no raise) | $200K | $55–65K | 3–4 months |
| Post-seed ($1.5M raised) | $1.5M | $70–98K (growing) | 18 months |
| Seed + early revenue | $1.5M + $540K revenue | Net burn declining | 24+ months |
| Post-Series A ($10M) | $10M + $2.8M revenue | Net burn near zero | Indefinite (profitable by Month 28) |

---

## 9. Sensitivity Analysis

### Revenue Scenarios

| Scenario | Year 1 | Year 3 | Year 5 | Assumptions |
|----------|--------|--------|--------|-------------|
| **Bear Case** | $270K | $4.8M | $26M | 50% of customer targets, 20% lower ARPC |
| **Base Case** | $540K | $9.5M | $52M | As projected above |
| **Bull Case** | $810K | $14.3M | $78M | 150% of customer targets, 15% higher ARPC |

### Key Sensitivity Variables

| Variable | Base Assumption | -20% Impact on Year 3 Revenue | +20% Impact |
|----------|----------------|-------------------------------|-------------|
| Customer acquisition rate | 300/yr (Year 1) | -$1.9M | +$1.9M |
| ARPC | $150/mo (Year 1) | -$1.5M | +$1.5M |
| Churn rate | 15% (Year 1) | +$0.8M (lower churn = more revenue) | -$1.2M |
| AI cost per interaction | $0.008 blended | -$0.2M on costs (cheaper AI) | +$0.3M |
| NRR | 105% (Year 1) | -$1.0M | +$1.0M |

### Break-Even Sensitivity

| Scenario | Break-Even Month | Total Capital Required |
|----------|-----------------|----------------------|
| Base case | Month 18 | $1.2M |
| Slow growth (-30%) | Month 26 | $2.0M |
| Fast growth (+30%) | Month 14 | $0.9M |
| Higher burn (+20%) | Month 22 | $1.6M |
| Lower ARPC (-20%) | Month 24 | $1.8M |

---

## 10. Key Financial Assumptions

| Assumption | Value | Basis |
|-----------|-------|-------|
| Free-to-paid conversion rate | 8–12% | Industry PLG benchmarks (Slack 30%, Figma 4%) |
| Monthly logo churn (Year 1) | 1.25% (15% annual) | Conservative for early-stage SaaS |
| Monthly logo churn (Year 5) | 0.33% (4% annual) | Compliance lock-in + integration depth |
| NRR | 105–122% over 5 years | Expansion revenue from usage growth + seat expansion |
| Gross margin (steady state) | 75–82% | B2B SaaS benchmark, AI costs optimized |
| Sales cycle (SMB) | 7–30 days | PLG-assisted |
| Sales cycle (Enterprise) | 90–180 days | Multi-stakeholder, compliance review |
| AI inference cost trend | -15% YoY | Historical model cost decline, competition |
| Infrastructure cost trend | -10% YoY per unit | Cloud pricing improvements, optimization |

---

## 11. Investor-Ready Summary

### The Opportunity

- **TAM:** $85B (global customer operations market)
- **SAM:** $12B (compliance-heavy verticals in North America)
- **SOM:** $600M (collections + healthcare + political in Year 5 addressable)

### The Economics

- **Year 1 Revenue:** $540K
- **Year 3 Revenue:** $9.5M (15% operating margin)
- **Year 5 Revenue:** $52M (42% operating margin)
- **Capital Efficiency:** $4.50+ ARR per $1 raised
- **LTV:CAC (steady state):** 13–19:1

### The Ask

- **Seed Round:** $1.5M for 18-month runway to achieve $1M ARR and SOC 2 Type II certification
- **Use of Funds:** 50% engineering, 20% sales/marketing, 15% compliance, 15% operations
- **Milestones to Series A:** $3M+ ARR, 1,000+ paying customers, SOC 2 Type II + HIPAA certified, 2 verticals live

---

*All projections are forward-looking estimates based on market research, comparable SaaS company benchmarks, and internal modeling. Actual results will vary. This document will be updated quarterly with actuals vs. projections.*
