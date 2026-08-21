# Stage 6 — Growth Engineering Closure

Stage 6 is implemented as one engineering package. It does not claim that traffic, revenue growth, or geographic expansion has already occurred.

## Measurement

- Privacy-safe PostHog quote-funnel events.
- Customer/contractor acquisition CTA events.
- No addresses, ZIPs, email/phone, free-text notes, quote/order/referral IDs, or query strings in growth analytics.

## Local acquisition

- Crawlable Johnston County and Harnett County service-area pages.
- `robots.txt` and `sitemap.xml`.
- Explicit-consent customer waitlist and contractor-interest capture with persistent server-side rate limits.

## Referral loop

- Referral codes become available only after a completed customer order.
- Referral landing records a visit without device fingerprinting.
- A real quote can be attributed to a referral via an HttpOnly first-party cookie.
- No reward or discount is promised by the implementation.

## Retention

- Customer-controlled annual service check-in preference.
- A completed order can schedule one annual check-in through the existing notification work/outbox pipeline.
- The message explicitly says the check-in is not a statement that pumping is currently required.

## Growth operations

- Admin-only aggregate growth scorecard.
- Experiment registry with hypothesis and guardrail fields.
- Experiment registry changes are audited and cannot alter pricing, dispatch, pilot controls, or payment behavior by themselves.

## Safety boundary

Stage 6 does not enable `PROVIDER_MODE=real`, `PILOT_MODE=sandbox`, database booking/payment execution, live Stripe keys, contractor approval, or live-money movement. Those remain explicit operational go-live decisions.
