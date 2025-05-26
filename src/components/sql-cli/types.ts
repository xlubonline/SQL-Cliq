export interface TableSchema {
  columnsDefinition: string; // e.g., "(id INT PRIMARY KEY, name VARCHAR(255))"
  // Future: Add more detailed column info if needed
  // columns: Array<{ name: string; type: string; constraints?: string }>;
}

export interface DatabaseSchema {
  tables: Record<string, TableSchema>;
}

export interface DatabasesStructure {
  [dbName: string]: DatabaseSchema;
}

export interface HistoryEntry {
  id: string;
  type: 'input' | 'output' | 'error' | 'assist-input' | 'assist-output';
  content: string | string[]; // string[] for multi-line output like SHOW TABLES
  prompt?: string; // For input entries, store the prompt used
}
