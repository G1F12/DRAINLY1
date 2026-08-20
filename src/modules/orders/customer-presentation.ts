const CONFIRMED_SERVICE_STATES = new Set([
  "SCHEDULED",
  "EN_ROUTE",
  "ARRIVED",
  "SERVICE_COMPLETED",
  "CLOSED",
]);

export function isServiceDateConfirmed(status: string): boolean {
  return CONFIRMED_SERVICE_STATES.has(status);
}

export function customerServiceMessage(status: string): { heading: string; detail: string } {
  if (status === "SEARCHING_CONTRACTOR") {
    return {
      heading: "Price locked — provider confirmation pending",
      detail: "We're confirming a local service provider for your requested date. Your service date is confirmed once a local contractor accepts the job.",
    };
  }
  if (isServiceDateConfirmed(status)) {
    return {
      heading: status === "CLOSED" ? "Service completed" : "Service date confirmed",
      detail: "A local contractor accepted your job. Check the status here for service updates.",
    };
  }
  return {
    heading: "Service update",
    detail: "Check the current order status for the latest service information.",
  };
}
