import { describe, expect, it } from "vitest";

import { customerServiceMessage, isServiceDateConfirmed } from "@/modules/orders/customer-presentation";
import { notificationCopy } from "@/modules/notifications/templates";

describe("customer booking semantics", () => {
  it("does not present a searching order as a confirmed appointment", () => {
    const message = customerServiceMessage("SEARCHING_CONTRACTOR");
    expect(isServiceDateConfirmed("SEARCHING_CONTRACTOR")).toBe(false);
    expect(`${message.heading} ${message.detail}`).not.toMatch(/appointment confirmed|service scheduled/i);
    expect(message.detail).toMatch(/confirmed once a local contractor accepts/i);
  });

  it("presents contractor-accepted service as confirmed", () => {
    expect(isServiceDateConfirmed("SCHEDULED")).toBe(true);
    expect(customerServiceMessage("SCHEDULED").heading).toMatch(/confirmed/i);
  });

  it("keeps booking and assignment notification templates semantically distinct", () => {
    const searching = notificationCopy("booking.created", "DRN-TEST");
    const assigned = notificationCopy("assignment.created", "DRN-TEST");
    expect(searching.body).toMatch(/confirmed once a local contractor accepts/i);
    expect(searching.subject).not.toMatch(/service date confirmed/i);
    expect(assigned.body).toMatch(/service date is now confirmed/i);
  });
});
