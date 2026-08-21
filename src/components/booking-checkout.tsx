"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { CheckCircle2, CreditCard, LoaderCircle, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";

type Setup = { customerId: string; setupIntentId: string; clientSecret: string; paymentMethodId?: string };
type CheckoutMode = "demo" | "stripe_test" | "live";

function idempotencyKey(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }

function SetupPaymentForm({
  quoteId,
  setup,
  testOnly,
  onComplete,
}: {
  quoteId: string;
  setup: Setup;
  testOnly: boolean;
  onComplete: (result: Record<string, unknown>) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setLoading(true);
    setError(undefined);

    const confirmation = await stripe.confirmSetup({ elements, redirect: "if_required" });
    if (confirmation.error) {
      setLoading(false);
      return setError(confirmation.error.message);
    }

    const paymentMethod = typeof confirmation.setupIntent?.payment_method === "string"
      ? confirmation.setupIntent.payment_method
      : confirmation.setupIntent?.payment_method?.id;

    if (!paymentMethod) {
      setLoading(false);
      return setError("Stripe did not return a reusable payment method.");
    }

    if (testOnly) {
      setLoading(false);
      onComplete({
        testSetupComplete: true,
        setupIntentId: setup.setupIntentId,
        paymentMethodId: paymentMethod,
      });
      return;
    }

    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey("booking"),
      },
      body: JSON.stringify({
        quoteId,
        stripeCustomerId: setup.customerId,
        setupIntentId: setup.setupIntentId,
        paymentMethodId: paymentMethod,
        offSessionConsentAccepted: true,
        consentVersion: "pilot-v1",
      }),
    });

    const data = await response.json() as Record<string, unknown> & { error?: { message?: string } };
    setLoading(false);
    if (!response.ok) return setError(data.error?.message ?? "Booking failed");
    onComplete(data);
  }

  return <form className="stack" onSubmit={submit}>
    <PaymentElement options={{ layout: "tabs" }} />
    {error && <div className="form-error" role="alert">{error}</div>}
    <button className="button button-primary" disabled={!stripe || loading}>
      {loading
        ? <><LoaderCircle size={18} className="animate-spin" /> Saving...</>
        : <><CreditCard size={18} /> {testOnly ? "Save Stripe test payment method" : "Save card and submit booking"}</>}
    </button>
  </form>;
}

export function BookingCheckout({
  quoteId,
  email,
  mode = "demo",
}: {
  quoteId: string;
  email: string;
  mode?: CheckoutMode;
}) {
  const isDemo = mode === "demo";
  const isStripeTest = mode === "stripe_test";
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const stripePromise = useMemo(() => publishableKey ? loadStripe(publishableKey) : null, [publishableKey]);

  const [consent, setConsent] = useState(false);
  const [setup, setSetup] = useState<Setup>();
  const [result, setResult] = useState<Record<string, unknown>>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  async function prepare() {
    setLoading(true);
    setError(undefined);

    const response = await fetch("/api/payments/setup-intent", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey("setup"),
      },
      body: JSON.stringify({ email }),
    });

    const data = await response.json() as Setup & { error?: { message?: string } };
    setLoading(false);
    if (!response.ok) return setError(data.error?.message ?? "Payment setup failed");

    setSetup(data);

    if (isDemo && data.paymentMethodId) {
      const booking = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey("booking"),
        },
        body: JSON.stringify({
          quoteId,
          stripeCustomerId: data.customerId,
          setupIntentId: data.setupIntentId,
          paymentMethodId: data.paymentMethodId,
          offSessionConsentAccepted: true,
          consentVersion: "pilot-v1",
        }),
      });
      const bookingData = await booking.json() as Record<string, unknown> & { error?: { message?: string } };
      if (!booking.ok) return setError(bookingData.error?.message ?? "Booking failed");
      setResult(bookingData);
    }
  }

  if (result) {
    if (isStripeTest || result.testSetupComplete) {
      return <div className="success-box">
        <CheckCircle2 size={20} style={{ display: "inline", marginRight: 8 }} />
        <strong>Stripe test card setup completed.</strong>
        <p>No Drainly booking, contractor dispatch, authorization, capture, or live charge was created.</p>
      </div>;
    }

    return <div className="success-box">
      <CheckCircle2 size={20} style={{ display: "inline", marginRight: 8 }} />
      <strong>{isDemo || result.demo ? "Demo booking completed." : "Your price is locked."}</strong>
      <p>
        {isDemo || result.demo
          ? "No payment was created and no contractor was dispatched. This confirms only that the demo workflow completed."
          : "We are confirming a local service provider for your requested date. Your service date is confirmed once a local contractor accepts the job."}
        {" "}Reference: {String(result.publicRef ?? result.orderId ?? "pending")}
      </p>
    </div>;
  }

  const heading = isDemo ? "Demo checkout" : isStripeTest ? "Stripe test payment method" : "Payment method";
  const description = isDemo
    ? "Demo mode does not collect or save a real card. This step uses simulated payment data to exercise the booking workflow."
    : isStripeTest
      ? "This saves only a Stripe test payment method. It does not create a Drainly order or request any charge."
      : "Drainly saves your card with Stripe. Scheduled jobs are authorized close to service and captured only after valid completion.";
  const consentCopy = isDemo
    ? "I understand this is a demo and does not create a real booking, payment, or contractor dispatch."
    : isStripeTest
      ? "I understand this is Stripe test mode and no live payment, booking, or contractor dispatch will be created."
      : "I authorize Drainly to save this payment method and initiate one off-session charge for the displayed booking total after the authorization and completion conditions described above.";

  return <div className="stack"><div className="panel">
    <div className="panel-header"><h2>{heading}</h2><ShieldCheck size={20} color="var(--teal)" /></div>
    <div className="panel-body stack">
      <p style={{ margin: 0, color: "var(--muted)" }}>{description}</p>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: ".88rem" }}>
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          style={{ marginTop: 4 }}
        />
        <span>{consentCopy}</span>
      </label>

      {error && <div className="form-error" role="alert">{error}</div>}

      {isStripeTest && !publishableKey && (
        <div className="form-error" role="alert">
          Stripe test publishable key is not configured for this deployment.
        </div>
      )}

      {!setup && <button
        className="button button-primary"
        disabled={!consent || loading || (isStripeTest && !stripePromise)}
        onClick={prepare}
      >
        {loading
          ? <LoaderCircle size={18} className="animate-spin" />
          : <><CreditCard size={18} /> {
              isDemo ? "Complete demo booking"
                : isStripeTest ? "Continue to Stripe test card setup"
                  : "Continue to secure card setup"
            }</>}
      </button>}

      {setup && !isDemo && stripePromise && (
        <Elements
          stripe={stripePromise}
          options={{
            clientSecret: setup.clientSecret,
            appearance: { theme: "stripe", variables: { colorPrimary: "#0d6b63", borderRadius: "12px" } },
          }}
        >
          <SetupPaymentForm
            quoteId={quoteId}
            setup={setup}
            testOnly={isStripeTest}
            onComplete={setResult}
          />
        </Elements>
      )}
    </div>
  </div></div>;
}
