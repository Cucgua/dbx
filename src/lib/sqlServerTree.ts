import type { TableInfo, TreeNode } from "@/types/database";

export const SQLSERVER_DEFAULT_SCHEMA = "dbo";

function isDefaultSchema(schema: string): boolean {
  return schema.toLowerCase() === SQLSERVER_DEFAULT_SCHEMA;
}

export function buildSqlServerDatabaseTreeNodes(
  connectionId: string,
  database: string,
  schemas: string[],
  defaultSchemaTables: TableInfo[],
): TreeNode[] {
  const databaseNodeId = `${connectionId}:${database}`;
  const defaultSchema = schemas.find(isDefaultSchema) || SQLSERVER_DEFAULT_SCHEMA;
  const defaultTableNodes = defaultSchemaTables.map((table) => ({
    id: `${databaseNodeId}:${defaultSchema}:${table.name}`,
    label: table.name,
    type: (table.table_type === "VIEW" ? "view" : "table") as "view" | "table",
    connectionId,
    database,
    schema: defaultSchema,
    isExpanded: false,
    children: [],
  }));

  const schemaNodes = schemas
    .filter((schema) => !isDefaultSchema(schema))
    .map((schema) => ({
      id: `${databaseNodeId}:${schema}`,
      label: schema,
      type: "schema" as const,
      connectionId,
      database,
      schema,
      isExpanded: false,
      children: [],
    }));

  return [...defaultTableNodes, ...schemaNodes];
}
