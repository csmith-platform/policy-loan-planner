# Loan Planner

A protected Cloudflare Worker application for maintaining a shared family-loan amortization schedule. Static assets and the authenticated API deploy together, while Cloudflare D1 stores the loan terms and payment-event audit trail.

## Stored records

- One shared loan record
- Extra and manual payments
- Missed scheduled-payment markers
- Creator and voiding identity from Cloudflare Access
- Creation and voiding timestamps

Future amortization rows are calculated rather than stored. Payment records are voided instead of deleted so the audit history remains available.

## Cloudflare setup

### 1. Create and initialize D1

```sh
npm install
npm run db:create
npm run db:migrate:remote
```

The migration inserts the initial $5,552.75, 10%, five-year biweekly loan.

### 2. Deploy the Worker

Connect this repository to a Cloudflare Worker build or run `npm run deploy`. Add a D1 binding to the Worker with variable name `DB` and database `policy-loan-planner`.

### 3. Add the custom domain

The Wrangler configuration attaches `loan.traderclay.com` as the Worker's custom domain. Because `traderclay.com` is already an active Cloudflare zone, Cloudflare can create the DNS record and certificate during deployment. Remove any existing DNS record for `loan.traderclay.com` before the first deployment if that hostname is already in use.

### 4. Protect all traffic with Access

In **Workers & Pages → policy-loan-planner → Access**, protect **all traffic**. Configure email one-time PIN authentication and allow only:

- `csmith.ab@gmail.com`
- `katsmith430@gmail.com`

Worker-level protection covers the static files, API, custom domain, `workers.dev` hostname, and previews. The API also checks the authenticated email against `ALLOWED_EMAILS`.

## Calculation convention

The nominal annual rate is divided by the selected payment periods per year. Extra and manual payments are applied on the first scheduled payment date on or after their recorded date. A missed-payment marker disables that scheduled payment and leaves the unpaid interest in the balance.

This is a planning tool. Confirm the lender's conventions before relying on its results.

