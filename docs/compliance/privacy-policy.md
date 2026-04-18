# ORDR-Connect — Privacy Policy (DRAFT)

> **Status:** DRAFT — pending review by Legal counsel and Marketing before
> public publication. Every bracketed `[LEGAL REVIEW]` and `[TODO]` marker
> below indicates a clause where the engineering reading of the product must
> be confirmed or expanded by Legal before the document is binding.
>
> This draft is authored by Platform Engineering + Compliance to capture the
> factual basis of our data practices as of 2026-04-18 (Phase 142). Do **not**
> publish as-is.

---

## 1. Who We Are

**Data Controller.** [LEGAL REVIEW — confirm legal entity name, registered
address, company registration number, and VAT / tax ID as they appear on the
Articles of Incorporation.]

ORDR-Connect is a product of Synexiun (trading as SynexCom) — a Customer
Operations Operating System that helps businesses run their customer
operations via event-sourced, multi-agent automation.

**Contact.** For any privacy-related inquiry, complaint, or data-subject
rights request: [LEGAL REVIEW — publish the monitored inbox and postal
address.]

- Privacy inbox: `privacy@ordr-connect.com`
- DSR endpoint: `support@ordr-connect.com` (tenant administrators may also
  open requests via the in-product *Settings → Compliance → DSR* flow).
- Data Protection Officer (DPO): [LEGAL REVIEW — appoint or confirm DPO
  only if required under GDPR Art. 37; if we are a processor for most
  tenants, a DPO may not be mandatory, but a named privacy contact is.]

---

## 2. Scope of this Policy

This policy applies to personal data we process when:

- You visit our public website or sign up for an account as an **administrator**
  or **agent** of a business customer ("Tenant").
- You are an **end customer** of a Tenant whose customer data is held inside
  ORDR-Connect on the Tenant's behalf.
- You interact with us in the course of evaluating, purchasing, or
  supporting the product.

We act as:

- **Data Controller** for data about our direct users (Tenant
  administrators, agents, website visitors, prospects).
- **Data Processor** for the Tenant's end-customer data (which includes,
  where applicable, Protected Health Information under HIPAA). In that
  role, we process end-customer data only under the Tenant's instructions
  as expressed through the product contract (MSA + DPA + BAA where
  relevant).

If you are an end customer of a Tenant and you contact us directly about
your personal data, we will in most cases refer your request to the
Tenant — who is the Controller — while providing reasonable cooperation
with the Tenant to give effect to your rights.

---

## 3. Personal Data We Process

### 3.1 About our direct users (Tenant admins, agents, prospects)

| Category | Examples | Source |
|----------|----------|--------|
| Identity | Name, email, work phone, role/title | You, your SSO provider (WorkOS) |
| Authentication | Hashed password (Argon2id), MFA tokens, session metadata | Generated during signup / login |
| Device & log | IP address, user agent, time stamps, API request metadata | Collected automatically when you use the product |
| Commercial | Billing name, billing address, invoice history | You, Stripe (payment processor) [LEGAL REVIEW — confirm Stripe is contracted as a subprocessor; update register if so] |
| Support | Messages you send to support, troubleshooting context | You |

### 3.2 About Tenants' end customers (we process on behalf of the Tenant)

| Category | Examples |
|----------|----------|
| Identity | Name, email, phone, postal address |
| Commercial | Order history, transaction records, payment metadata (tokenised) |
| Interaction | Messages, call transcripts, chat logs, support tickets |
| Behavioural | Product usage, engagement signals, survey responses |
| Profile | Segmentation attributes assigned by the Tenant |
| Health (PHI) | Only where the Tenant is a HIPAA Covered Entity and has executed a Business Associate Agreement with us, and only the fields the Tenant chooses to send |

We do **not** sell end-customer data. We do not use end-customer data to
train our own generally-available machine-learning models. Any ML feature
operates on a per-Tenant boundary and is trained only within that
Tenant's data space unless the Tenant has explicitly opted in to a cohort
model.

### 3.3 Data we deliberately do **not** collect

- We do not deploy cross-site advertising trackers.
- We do not collect special-category GDPR data (racial or ethnic origin,
  political opinions, religious beliefs, biometric data, genetic data,
  sexual orientation) unless a HIPAA-BAA'd Tenant transmits it as part
  of a clinical record. Even then, it is processed only on the Tenant's
  instructions.
- We do not intentionally collect personal data from children under 13
  (COPPA) or under 16 (GDPR). ORDR-Connect is a B2B product. If you
  believe a child's data has reached our systems through a Tenant, please
  contact the Tenant and copy us at `privacy@ordr-connect.com`.

---

## 4. Why We Process (Lawful Bases under GDPR Art. 6 and HIPAA §164.506)

| Purpose | Lawful Basis |
|---------|--------------|
| To provide you the product and fulfil our contract with your employer | Contract (Art. 6(1)(b)) |
| To secure the service, detect abuse, prevent fraud | Legitimate interest (Art. 6(1)(f)) + Legal obligation (Art. 6(1)(c)) |
| To comply with HIPAA, SOC 2, ISO 27001, financial-records law | Legal obligation (Art. 6(1)(c)) |
| To send you product updates, security bulletins, billing | Contract + Legitimate interest |
| To send you marketing emails (prospects and opted-in users only) | Consent (Art. 6(1)(a)) — revocable at any time |
| To process PHI for treatment, payment, and healthcare operations on the Tenant's behalf | HIPAA §164.506 + executed BAA |

For end-customer data we process as a processor, the lawful basis is
determined by the Tenant. We do not process end-customer data for our own
purposes.

---

## 5. Who We Share Data With

We share personal data with the following categories of recipient:

- **Subprocessors.** The complete list — with purpose, data category,
  region, certifications, and BAA/DPA status — is kept continuously
  current in our [Subprocessor Register](./subprocessor-register.md).
  Tenants receive 30-day advance notice of additions or removals.
- **Authorities and regulators.** Only as compelled by law (court order,
  subpoena, lawful supervisory request). We will notify the affected
  Tenant if we are permitted to do so.
- **Successors in interest.** In the event of a merger, acquisition, or
  asset sale, personal data may be transferred to the successor. We will
  require any successor to honour this policy and applicable contracts,
  and we will notify affected Tenants before such a transfer takes effect.

We do **not** share personal data with advertisers, data brokers, or
unaffiliated marketing partners.

### CCPA / CPRA disclosure

For California residents: [LEGAL REVIEW — confirm or adjust.]

- We do **not** "sell" personal information within the meaning of
  California Civil Code §1798.140.
- We do **not** "share" personal information for cross-context behavioural
  advertising.
- We disclose personal information to service providers (our subprocessors)
  for business purposes as listed above.
- California-specific rights are described in §7 below.

---

## 6. International Data Transfers

ORDR-Connect is hosted primarily in AWS US-East-1 (with US-West-2 for
disaster recovery). Data originating in the European Economic Area, the
United Kingdom, or Switzerland will therefore cross a border when
transmitted to our infrastructure.

For those transfers we rely on:

- **Standard Contractual Clauses (SCCs)** adopted by the European
  Commission (Decision 2021/914) together with our subprocessors' SCC
  incorporations.
- **UK International Data Transfer Addendum** where UK law applies.
- **Transfer Impact Assessments** documented per recipient, per risk level.
- **Technical supplementary measures:** AES-256-GCM at rest, TLS 1.3 in
  transit, mTLS between services, application-layer encryption of PHI and
  highly sensitive PII before storage.

Tenants who require EU-region hosting may request it; regional EU hosting is
on our roadmap. [LEGAL REVIEW — confirm we are not contractually committing
to a timeline; strike or hedge if so.]

---

## 7. Your Rights

Depending on where you are resident, you have some or all of the following
rights:

| Right | Jurisdiction |
|-------|--------------|
| Access — know what data we hold | GDPR Art. 15, CCPA §1798.110, HIPAA §164.524 |
| Rectification — correct inaccurate data | GDPR Art. 16, CCPA §1798.106, HIPAA §164.526 |
| Erasure ("right to be forgotten") | GDPR Art. 17, CCPA §1798.105 |
| Restriction of processing | GDPR Art. 18 |
| Portability — receive your data in machine-readable form | GDPR Art. 20, CCPA §1798.130(a)(2) |
| Objection to processing based on legitimate interest | GDPR Art. 21 |
| Withdrawal of consent | GDPR Art. 7(3) |
| Opt-out of "sale" or "sharing" | CCPA §1798.120 (we do not sell or share, but the right exists) |
| Limit use of sensitive personal information | CPRA |
| Appeal a denied request | Various state laws |
| Lodge a complaint with a supervisory authority | GDPR Art. 77 |

**How to exercise.** If you are a direct user, email
`privacy@ordr-connect.com` or use the in-product *Settings → Compliance →
DSR* flow. If you are an end customer of a Tenant, please contact the
Tenant first; if they are non-responsive and you are an EU/UK resident,
you may contact us and we will work with the Tenant to give effect to
your request.

**Response timeline.** We acknowledge requests within 7 days and fulfil or
formally decline them within **30 days** (extendable by 60 days for
complex requests under GDPR Art. 12(3)). We do not charge a fee unless the
request is manifestly unfounded or excessive.

**Identity verification.** We may ask you to verify your identity before
we act on a request — particularly for erasure — to prevent another person
from impersonating you. We will use the minimum data necessary for this
purpose.

---

## 8. How Long We Keep Data

| Data | Retention |
|------|-----------|
| Direct-user account data | For the life of your account + 90 days for deletion propagation |
| Direct-user billing records | 7 years after the last transaction (tax law) |
| End-customer data | Per the Tenant's instructions; default is for the life of the Tenant's account |
| Audit logs (WORM) | 7 years minimum (HIPAA 6yr / SOC 2 + financial 7yr — we apply the higher) |
| Backups | 35 days rolling, encrypted, deleted on schedule |
| Support correspondence | 3 years after ticket closure |
| Marketing engagement | Until you unsubscribe, or 3 years of inactivity, whichever is sooner |

When data reaches end-of-retention, we destroy it. For encrypted PHI, we
exercise **cryptographic erasure** — destroying the per-record encryption
key so the ciphertext becomes unrecoverable — which satisfies HIPAA
§164.310(d)(2)(i).

[LEGAL REVIEW — confirm retention figures are consistent with executed
customer contracts and with any jurisdiction-specific mandates (e.g.,
German tax records = 10 years).]

---

## 9. How We Secure Data

A technical summary — the full control set is in our SOC 2 Type II report
and ISO 27001 Statement of Applicability, available under NDA.

- AES-256-GCM encryption at rest, TLS 1.3 in transit, mTLS between
  services, HSM-backed key management with 90-day rotation.
- OAuth 2.1 + PKCE for authentication, Argon2id password hashing, MFA
  mandatory for all production access.
- Row-Level Security in the database enforces multi-tenant isolation
  at every query.
- Every state change is recorded in an append-only audit chain with
  per-event SHA-256 linkage and a Merkle-tree verification root,
  replicated to S3 Object Lock (Compliance mode).
- 24/7 security monitoring, automated alerting on audit-chain break,
  authentication anomalies, privilege escalation.
- Annual third-party penetration test. [LEGAL REVIEW — do not publish
  "annual" until the first engagement is scheduled; see evidence-index
  gap list.]

Incident response: we maintain a tested runbook and a 72-hour GDPR
breach-notification workflow + 60-day HIPAA notification workflow. See
our public [Security page](https://www.ordr-connect.com/security)
[LEGAL REVIEW — verify URL] for real-time status and trust evidence.

---

## 10. Cookies and Similar Technologies

The public website and the authenticated product use cookies and similar
technologies for:

- **Strictly necessary** — session, CSRF, load balancing. Required for
  the product to function. Not revocable without losing functionality.
- **Preferences** — UI theme, saved filters.
- **Security** — bot detection, rate-limit counters.
- **Analytics** — aggregated, anonymised product-usage metrics (we use
  [TODO: confirm analytics vendor if any — Plausible, PostHog,
  Google Analytics 4] with IP anonymisation).

We do **not** use advertising cookies or cross-site tracking pixels.

A cookie banner on first visit lets EU/UK/CH/California visitors control
non-essential cookies. You can also clear cookies via your browser at any
time.

[LEGAL REVIEW — a full cookie policy (table of each cookie + purpose +
duration) should accompany publication. Suggest authoring it separately
after the analytics vendor decision is final.]

---

## 11. Automated Decision-Making and AI

ORDR-Connect uses AI to assist with customer operations — ranking
inbound items, routing requests, drafting outbound messages, and
summarising context for human agents. All such assistance is:

- **Grounded** in the Tenant's own data (RAG retrieval), not in general
  web scraping.
- **Bounded** — each agent role has an explicit tool allowlist and
  per-execution budget (tokens, actions, cost).
- **Audited** — every prompt, reasoning trace, action, and outcome is
  recorded in the WORM audit chain.
- **Reversible or escalated** — actions below a confidence threshold, and
  all financially-material or PHI-accessing actions, route to a human
  reviewer.

GDPR Art. 22 "solely automated decisions" — we do not make
solely-automated decisions with legal or similarly significant effects on
end customers without the Tenant's explicit configuration to do so, and
the right to human review remains available in every such flow.

---

## 12. Children's Privacy

ORDR-Connect is a business-to-business product. We do not knowingly
collect personal data from children. If you believe a child's data has
reached our systems through a Tenant's use of the product, please
contact the Tenant and copy `privacy@ordr-connect.com`; we will work with
the Tenant to have it removed promptly.

---

## 13. Changes to This Policy

We review this policy at least annually and whenever a material change to
our data practices occurs. Material changes are announced:

- By email to the Tenant's designated Compliance Contact at least 30 days
  in advance, where practicable.
- By in-product notice at next login.
- By updating the "Last Updated" date at the top of this page. The
  current version is always at `https://www.ordr-connect.com/privacy`
  [LEGAL REVIEW — confirm URL].

A version history is retained at the end of this document.

---

## 14. Contact Us

- Privacy inbox: `privacy@ordr-connect.com`
- Postal address: [LEGAL REVIEW — registered office address]
- EU / UK representative (if required): [LEGAL REVIEW — appoint under GDPR
  Art. 27 only if we market into the EU without EU establishment; confirm
  establishment status first.]

If you are not satisfied with our response, you have the right to lodge a
complaint with a supervisory authority — in the EU, the Data Protection
Authority of the Member State in which you live, work, or believe the
infringement occurred; in the UK, the Information Commissioner's Office
(`ico.org.uk`); in California, the California Privacy Protection Agency
(`cppa.ca.gov`).

---

## Governing Law

[LEGAL REVIEW — confirm governing law and venue clauses match the Master
Services Agreement template.]

---

## Revision History

| Version | Date | Change | Author |
|---------|------|--------|--------|
| 0.1 DRAFT | 2026-04-18 | Initial draft (Phase 142) — pending legal review | Platform Engineering + Compliance |

---

**[FOR INTERNAL CIRCULATION ONLY — NOT FOR PUBLIC PUBLICATION.]**

Before publication:

1. Legal counsel review of every `[LEGAL REVIEW]` marker.
2. Marketing review of tone and URL references.
3. DPO (if appointed) review of GDPR-specific sections.
4. Executive sign-off.
5. Replace "DRAFT" banner, bump version to 1.0, set effective date.
6. Publish to `www.ordr-connect.com/privacy` and link from product
   footer and signup flow.
7. Notify Tenants of the new policy per §13.
8. Update `docs/compliance/evidence-index.md` to move the row from the
   Gap table to the P1.1 evidence row.
