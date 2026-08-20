export type NotificationRecipientType = "CUSTOMER" | "CONTRACTOR" | "ADMIN";

export function notificationCopy(
  topic: string,
  publicRef: string,
  recipientType: NotificationRecipientType = "CUSTOMER",
): { subject: string; body: string } {
  if (recipientType === "ADMIN") {
    return {
      subject: `Drainly ops alert: ${publicRef}`,
      body: `Drainly order ${publicRef} requires attention: ${topic.replaceAll(".", " ")}. Review the operations dashboard.`,
    };
  }

  if (topic === "booking.created") {
    return {
      subject: `Drainly price locked: ${publicRef}`,
      body: `Your price is locked for Drainly order ${publicRef}. We're confirming a local service provider for your requested date. Your service date is confirmed once a local contractor accepts the job. Sign in to view details.`,
    };
  }
  if (topic === "assignment.created") {
    return recipientType === "CONTRACTOR"
      ? {
        subject: `New Drainly job confirmed: ${publicRef}`,
        body: `You accepted Drainly job ${publicRef}. Review the job details and service date in your contractor dashboard.`,
      }
      : {
        subject: `Drainly service date confirmed: ${publicRef}`,
        body: `A local contractor accepted Drainly order ${publicRef}, so your service date is now confirmed. Sign in to view details.`,
      };
  }
  if (topic === "order.service_reminder") {
    return recipientType === "CONTRACTOR"
      ? {
        subject: `Drainly job reminder: ${publicRef}`,
        body: `Reminder: Drainly job ${publicRef} is scheduled soon. Review the job details before service.`,
      }
      : {
        subject: `Drainly service reminder: ${publicRef}`,
        body: `Reminder: your Drainly service for order ${publicRef} is scheduled soon. Sign in to review access instructions and status.`,
      };
  }
  if (topic === "order.en_route") {
    return { subject: `Your Drainly contractor is on the way: ${publicRef}`, body: `Your contractor marked Drainly order ${publicRef} as en route. Sign in for the latest status.` };
  }
  if (topic === "order.arrived") {
    return { subject: `Drainly contractor arrived: ${publicRef}`, body: `Your contractor marked Drainly order ${publicRef} as arrived. Sign in for the latest status.` };
  }
  if (topic === "order.service_completed") {
    return { subject: `Drainly service completed: ${publicRef}`, body: `Service for Drainly order ${publicRef} was marked complete. Payment and final order status may still be processing. Sign in to review details.` };
  }
  if (topic === "order.closed") {
    return { subject: `Drainly order complete: ${publicRef}`, body: `Drainly order ${publicRef} is complete. Sign in to review the final status and service details.` };
  }
  if (topic === "order.cancelled") {
    return recipientType === "CONTRACTOR"
      ? { subject: `Drainly job cancelled: ${publicRef}`, body: `Drainly job ${publicRef} was cancelled. Review your contractor dashboard for the current status.` }
      : { subject: `Drainly order cancelled: ${publicRef}`, body: `Drainly order ${publicRef} was cancelled. Sign in to review the current status.` };
  }
  if (topic === "order.failed_access") {
    return { subject: `Drainly could not access the system: ${publicRef}`, body: `The contractor reported that Drainly order ${publicRef} could not be completed because access was unavailable. Sign in to review the status and next steps.` };
  }
  if (topic === "order.failed_service") {
    return { subject: `Drainly service issue: ${publicRef}`, body: `The contractor reported a service issue for Drainly order ${publicRef}. The order needs review. Sign in for the latest status.` };
  }
  if (topic === "payment.action_required") {
    return { subject: `Payment action required: ${publicRef}`, body: `Payment for Drainly order ${publicRef} needs attention. Sign in to review the payment status.` };
  }
  if (topic === "assignment.deadline_missed") {
    return { subject: `Drainly is reviewing your booking: ${publicRef}`, body: `We could not confirm a contractor for Drainly order ${publicRef} within the expected window. The booking is being reviewed. Sign in for the latest status.` };
  }
  return {
    subject: `Drainly update: ${publicRef}`,
    body: `There is a ${topic.replaceAll(".", " ")} update for Drainly order ${publicRef}. Sign in to view details.`,
  };
}
