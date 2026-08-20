# Production gates

No item in this document is satisfied by local or Stripe test-mode success. Each gate requires an attributable review record before production activation.

## Stripe Connect country/configuration review

- Confirm the actual Drainly platform account country.
- Confirm intended US connected-account countries and configuration.
- Confirm destination charges and explicit `transfer_data[amount]` availability.
- Confirm cross-region transfer support for every planned account pairing.
- Document `on_behalf_of` requirements and tested behavior.
- Document settlement merchant and statement descriptor behavior.
- Confirm who pays Stripe processing fees.
- Confirm refund, dispute, chargeback, transfer-reversal, payout, and negative-balance responsibility.
- Record the Stripe reviewer, account identifiers, review date, evidence links, and final approval.

Any mismatch is a hard go-live blocker.

## Business and operational review

- Contractor approval, insurance, licensing, tax, and payout procedures.
- Customer cancellation/refund policy and dispute response ownership.
- SMS consent language and opt-out handling before any real SMS.
- Privacy terms, retention, proof access, and incident response.
- Backup, restore, recovery-time, and reconciliation drills.
- Production secret management, rotation, Sentry/PostHog redaction, and alert routing.
- Load/concurrency evidence and county/date capacity limits.
