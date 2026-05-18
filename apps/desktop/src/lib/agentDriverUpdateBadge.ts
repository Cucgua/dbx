export interface AgentDriverUpdateBadgeState {
  update_available: boolean;
}

export function countAvailableAgentDriverUpdates(drivers: readonly AgentDriverUpdateBadgeState[]): number {
  return drivers.filter((driver) => driver.update_available).length;
}
