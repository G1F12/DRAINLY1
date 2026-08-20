# ADR 003: Firm quote supply and net contribution

Status: accepted.

A regional rate does not by itself produce a firm quote. `PRICED` requires active geography, a regional rule, current eligible/Connect-ready capacity, funded contractor payout, a conservative versioned processing-fee estimate, and expected net contribution at or above the configured threshold.

Candidates are advisory snapshots. Booking, acceptance, and reassignment recompute current coverage, availability, capacity, price, funding, and contribution. An MFA admin can immutably reduce the threshold for a quote, but cannot permit payout above customer funds.
