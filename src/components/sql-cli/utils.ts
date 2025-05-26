import type { DatabasesStructure, TableSchema, DatabaseSchema } from './types';

export const parseCommand = (command: string): { commandName: string; args: string[] } => {
  const parts = command.trim().split(/\s+/);
  return {
    commandName: parts[0]?.toUpperCase() || '',
    args: parts.slice(1),
  };
};

const formatTableOutput = (headers: string[], rows: string[][]): string[] => {
  if (rows.length === 0 && headers.length === 1) { // For simple list like SHOW DATABASES
    return [headers[0], '-'.repeat(Math.max(10, headers[0].length)), ...rows.flat()];
  }
  if (rows.length === 0) {
    return ["Empty set"];
  }

  const colWidths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map(row => row[i]?.length || 0))
  );

  const formatRow = (row: string[]) =>
    '| ' + row.map((cell, i) => (cell || '').padEnd(colWidths[i])).join(' | ') + ' |';

  const separator = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';

  return [separator, formatRow(headers), separator, ...rows.map(formatRow), separator];
};


export const handleCreateDatabase = (
  dbName: string,
  databases: DatabasesStructure
): { newDatabases: DatabasesStructure; output: string } => {
  if (!dbName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
    return { newDatabases: databases, output: `Error: Invalid database name '${dbName}'. Names must start with a letter or underscore, followed by letters, numbers, or underscores.` };
  }
  if (databases[dbName]) {
    return { newDatabases: databases, output: `Error: Database '${dbName}' already exists.` };
  }
  const newDatabases = { ...databases, [dbName]: { tables: {} } };
  return { newDatabases, output: `Database '${dbName}' created successfully.` };
};

export const handleShowDatabases = (databases: DatabasesStructure): string[] => {
  const dbNames = Object.keys(databases);
  if (dbNames.length === 0) {
    return ["Empty set (0 databases)"];
  }
  return formatTableOutput(['Database'], dbNames.map(name => [name]));
};

export const handleUseDatabase = (
  dbName: string,
  databases: DatabasesStructure
): { newCurrentDb: string | null; output: string } => {
  if (!databases[dbName]) {
    return { newCurrentDb: null, output: `Error: Unknown database '${dbName}'.` };
  }
  return { newCurrentDb: dbName, output: `Database changed to '${dbName}'.` };
};

export const handleCreateTable = (
  fullCommand: string,
  currentDbName: string | null,
  databases: DatabasesStructure
): { newDatabases: DatabasesStructure; output: string } => {
  if (!currentDbName) {
    return { newDatabases: databases, output: "Error: No database selected. Use 'USE <database_name>;'." };
  }

  const match = fullCommand.match(/^CREATE\s+TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\((.+)\)\s*;?$/i);
  if (!match) {
    return { newDatabases: databases, output: "Error: Invalid CREATE TABLE syntax. Expected: CREATE TABLE table_name (column1_def, column2_def, ...);" };
  }

  const [, tableName, columnsDefinition] = match;

  if (!tableName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
     return { newDatabases: databases, output: `Error: Invalid table name '${tableName}'.` };
  }
  
  if (databases[currentDbName]?.tables[tableName]) {
    return { newDatabases: databases, output: `Error: Table '${tableName}' already exists in database '${currentDbName}'.` };
  }

  const newTable: TableSchema = { columnsDefinition: columnsDefinition.trim() };
  const updatedDb: DatabaseSchema = {
    ...databases[currentDbName],
    tables: {
      ...databases[currentDbName].tables,
      [tableName]: newTable,
    },
  };
  const newDatabases = { ...databases, [currentDbName]: updatedDb };
  return { newDatabases, output: `Table '${tableName}' created successfully in database '${currentDbName}'.` };
};

export const handleShowTables = (
  currentDbName: string | null,
  databases: DatabasesStructure
): string[] => {
  if (!currentDbName) {
    return ["Error: No database selected. Use 'USE <database_name>;'."];
  }
  const db = databases[currentDbName];
  if (!db) {
    // Should not happen if currentDbName is set correctly
    return [`Error: Current database '${currentDbName}' not found.`];
  }
  const tableNames = Object.keys(db.tables);
  if (tableNames.length === 0) {
    return [`Empty set (0 tables in ${currentDbName})`];
  }
  return formatTableOutput([`Tables_in_${currentDbName}`], tableNames.map(name => [name]));
};

export const handleDescribeTable = (
  tableName: string,
  currentDbName: string | null,
  databases: DatabasesStructure
): string[] => {
  if (!currentDbName) {
    return ["Error: No database selected. Use 'USE <database_name>;'."];
  }
  const table = databases[currentDbName]?.tables[tableName];
  if (!table) {
    return [`Error: Unknown table '${tableName}' in database '${currentDbName}'.`];
  }
  // Simplified: just show the raw column definition
  // A more complex parser would break this down into Field, Type, Null, Key, Default, Extra
  return formatTableOutput(
    ['Field Definition'],
    [[table.columnsDefinition]]
  );
};
