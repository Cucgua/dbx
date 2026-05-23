import type { ColumnInfo, DatabaseType, IndexInfo } from "../types/database.ts";

export interface EditableStructureColumn {
  id: string;
  name: string;
  dataType: string;
  isNullable: boolean;
  defaultValue: string;
  comment: string;
  isPrimaryKey: boolean;
  original?: ColumnInfo;
  originalPosition?: number;
  markedForDrop: boolean;
}

export interface EditableStructureIndex {
  id: string;
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
  filter: string;
  indexType: string;
  includedColumns: string[];
  comment: string;
  original?: IndexInfo;
  markedForDrop: boolean;
}

export interface BuildTableStructureChangeSqlOptions {
  databaseType?: DatabaseType;
  schema?: string;
  tableName: string;
  columns: EditableStructureColumn[];
  indexes: EditableStructureIndex[];
}

export interface TableStructureChangeSql {
  statements: string[];
  warnings: string[];
}
