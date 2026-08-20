export function notificationCopy(topic: string, publicRef: string): { subject: string; body: string } {
  if (topic === "booking.created") {
    return {
      subject: `Drainly price locked: ${publicRef}`,
      body: `Your price is locked for Drainly order ${publicRef}. We're confirming a local service provider for your requested date. Your service date is confirmed once a local contractor accepts the job. Sign in to view details.`,
    };
  }
  if (topic === "assignment.created") {
    return {
      subject: `Drainly service date confirmed: ${publicRef}`,
      body: `A local contractor accepted Drainly order ${publicRef}, so your service date is now confirmed. Sign in to view details.`,
    };
  }
  return {
    subject: `Drainly update: ${publicRef}`,
    body: `There is a ${topic.replaceAll(".", " ")} update for Drainly order ${publicRef}. Sign in to view details.`,
  };
}
