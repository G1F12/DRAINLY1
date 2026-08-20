export function StatusBadge({ status }: { status: string }) {
  const normalized = status.replaceAll("_", " ");
  const tone = ["CLOSED", "CAPTURED", "AUTHORIZED", "COMPLETED", "APPROVED"].includes(status) ? "good"
    : ["FAILED", "CANCELLED", "ACTION_REQUIRED", "DISABLED"].includes(status) ? "bad"
      : ["SEARCHING_CONTRACTOR", "PENDING", "AUTHORIZATION_SCHEDULED"].includes(status) ? "warn" : "info";
  return <span className={`status status-${tone}`}>{normalized}</span>;
}
