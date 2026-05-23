import type { DatabaseType } from "@/types/database";
import { supportsDriverManagement } from "./databaseCapabilities";

export interface AgentDriverInstallState {
  db_type: string;
  installed: boolean;
}

export function showAgentDriverInstallHint(
  dbType: DatabaseType | undefined,
  drivers: readonly AgentDriverInstallState[],
  driverProfile?: string,
): boolean {
  if (!supportsDriverManagement(dbType)) return false;
  const driverKey = dbType === "oracle" && driverProfile === "oracle-10g" ? "oracle-10g" : dbType;
  return drivers.find((driver) => driver.db_type === driverKey)?.installed !== true;
}
