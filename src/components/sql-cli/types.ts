export interface ColumnDefinition {
  name: string;
  type: string; // e.g., "INT", "VARCHAR(255)", "TEXT"
  // Future: Add constraints like NOT NULL, PRIMARY KEY details if more advanced parsing is needed
}

export interface TableSchema {
  columnsDefinition: string; // e.g., "(id INT PRIMARY KEY, name VARCHAR(255))"
  parsedColumns: ColumnDefinition[]; // Parsed from columnsDefinition
  data: Array<Record<string, any>>; // Actual row data
}

export interface DatabaseSchema {
  tables: Record<string, TableSchema>;
  passwordHash?: string; // Optional: SHA256 hash of the database password
}

export interface DatabasesStructure {
  [dbName: string]: DatabaseSchema;
}

export interface HistoryEntry {
  id: string;
  type: 'input' | 'output' | 'error' | 'assist-input' | 'assist-output' | 'comment';
  content: string | string[]; // string[] for multi-line output like SHOW TABLES
  prompt?: string; // For input entries, store the prompt used
}
