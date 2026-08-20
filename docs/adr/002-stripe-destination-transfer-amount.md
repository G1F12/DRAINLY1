# ADR 002: Stripe destination transfer amount

Status: accepted.

Drainly customer pricing and contractor economics are separate. Destination PaymentIntents set the customer total as the charge amount and the contractor payout as `transfer_data[amount]`. The platform does not send `application_fee_amount`.

This makes the transfer explicit, prevents accidental coupling to Drainly’s contractor marketplace fee, and leaves actual platform economics to reconciliation. Pilot automation rejects any payout above customer funds.
