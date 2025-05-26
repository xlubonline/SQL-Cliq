
import type { DatabasesStructure, TableSchema, DatabaseSchema, ColumnDefinition } from './types';

export const parseCommand = (command: string): { commandName: string; args: string[] } => {
  const parts = command.trim().split(/\s+/);
  return {
    commandName: parts[0]?.toUpperCase() || '',
    args: parts.slice(1),
  };
};

const formatTableOutput = (headers: string[], rows: string[][]): string[] => {
  if (rows.length === 0 && headers.length === 1 && headers[0] !== 'Field Definition') { 
    return [headers[0], '-'.repeat(Math.max(10, headers[0].length)), ...rows.flat()];
  }
  if (rows.length === 0) {
    return ["Empty set"];
  }

  const colWidths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map(row => String(row[i] ?? '').length))
  );

  const formatRow = (row: string[]) =>
    '| ' + row.map((cell, i) => String(cell ?? '').padEnd(colWidths[i])).join(' | ') + ' |';

  const separator = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';

  return [separator, formatRow(headers), separator, ...rows.map(formatRow), separator];
};

// Helper to parse column definitions string like "id INT, name VARCHAR(100)"
export const parseColumnDefinitions = (definitionStr: string): ColumnDefinition[] => {
  if (!definitionStr) return [];
  const columns: ColumnDefinition[] = [];
  const defs = definitionStr.split(',');
  defs.forEach(def => {
    const parts = def.trim().match(/(\w+)\s+(.+)/); // Matches "name TYPE"
    if (parts && parts.length === 3) {
      columns.push({ name: parts[1].trim(), type: parts[2].trim().toUpperCase() });
    }
  });
  return columns;
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

  const [, tableName, columnsDefinitionStr] = match;

  if (!tableName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) {
     return { newDatabases: databases, output: `Error: Invalid table name '${tableName}'.` };
  }
  
  if (databases[currentDbName]?.tables[tableName]) {
    return { newDatabases: databases, output: `Error: Table '${tableName}' already exists in database '${currentDbName}'.` };
  }

  const parsedColumns = parseColumnDefinitions(columnsDefinitionStr.trim());
  if (parsedColumns.length === 0 && columnsDefinitionStr.trim() !== "") {
    return { newDatabases: databases, output: `Error: Could not parse column definitions for table '${tableName}'. Ensure format is 'colName TYPE, ...'.`};
  }

  const newTable: TableSchema = { 
    columnsDefinition: columnsDefinitionStr.trim(),
    parsedColumns,
    data: [] 
  };
  const updatedDb: DatabaseSchema = {
    ...databases[currentDbName],
    tables: {
      ...(databases[currentDbName]?.tables || {}), // Ensure tables object exists
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
  
  const headers = ['Field', 'Type'];
  // Constraints (Null, Key, Default, Extra) are not fully parsed yet, just showing name and type
  const rows = table.parsedColumns.map(col => [col.name, col.type.toUpperCase()]);
  
  if (rows.length === 0) {
    return [`Table '${tableName}' has no defined columns or definition is malformed.`];
  }
  
  return formatTableOutput(headers, rows);
};

export const handleInsertData = (
  fullCommand: string,
  currentDbName: string | null,
  databases: DatabasesStructure
): { newDatabases?: DatabasesStructure; output: string | string[] } => {
  if (!currentDbName || !databases[currentDbName]) {
    return { output: "Error: No database selected or database does not exist. Use 'USE <database_name>;'." };
  }

  const match = fullCommand.match(/^INSERT\s+INTO\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\(([^)]+)\))?\s*VALUES\s*\(([^)]+)\)\s*;?/i);
  if (!match) {
    return { output: "Error: Invalid INSERT syntax. Expected: INSERT INTO table_name [(col1, col2, ...)] VALUES (val1, val2, ...);" };
  }

  const [, tableName, columnNamesStr, valuesStr] = match;
  const table = databases[currentDbName].tables[tableName];

  if (!table) {
    return { output: `Error: Table '${tableName}' does not exist in database '${currentDbName}'.` };
  }

  const values = valuesStr.split(',').map(v => v.trim().replace(/^['"]|['"]$/g, '')); // Strip quotes and trim

  // Determine target columns: either specified in INSERT or all columns from table schema
  let targetColumns: ColumnDefinition[];
  if (columnNamesStr) {
    const specifiedColumnNames = columnNamesStr.split(',').map(name => name.trim());
    targetColumns = specifiedColumnNames.map(name => {
      const colDef = table.parsedColumns.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (!colDef) throw new Error(`Column '${name}' not found in table '${tableName}'.`); // This error should be caught and returned as output
      return colDef;
    });
  } else {
    targetColumns = table.parsedColumns;
  }
  
  if (values.length !== targetColumns.length) {
    return { output: `Error: Column count (${targetColumns.length}) does not match value count (${values.length}).` };
  }

  const newRow: Record<string, any> = {};
  try {
    for (let i = 0; i < targetColumns.length; i++) {
      const colDef = targetColumns[i];
      let value: any = values[i];

      if (colDef.type.startsWith('INT') || colDef.type.startsWith('INTEGER')) {
        const num = parseInt(value, 10);
        if (isNaN(num)) {
          return { output: `Error: Invalid integer value '${value}' for column '${colDef.name}'.` };
        }
        value = num;
      }
      // Add more type coercions if needed (e.g., BOOLEAN, DATE)
      newRow[colDef.name] = value;
    }
  } catch (e: any) {
     return { output: e.message };
  }


  const updatedTableData = [...table.data, newRow];
  const updatedDatabases = {
    ...databases,
    [currentDbName]: {
      ...databases[currentDbName],
      tables: {
        ...databases[currentDbName].tables,
        [tableName]: {
          ...table,
          data: updatedTableData,
        },
      },
    },
  };

  return { newDatabases: updatedDatabases, output: `1 row inserted into '${tableName}'.` };
};

export const handleSelectData = (
  fullCommand: string,
  currentDbName: string | null,
  databases: DatabasesStructure
): { output: string | string[] } => {
  if (!currentDbName || !databases[currentDbName]) {
    return { output: "Error: No database selected or database does not exist. Use 'USE <database_name>;'." };
  }
  
  // Regex to capture: SELECT (columns) FROM (tableName) [WHERE (condition)]
  const match = fullCommand.match(/^SELECT\s+(.+?)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+WHERE\s+(.+?))?\s*;?$/i);

  if (!match) {
    return { output: "Error: Invalid SELECT syntax. Expected: SELECT columns FROM table_name [WHERE condition];" };
  }

  const [, columnsStr, tableName, whereClauseStr] = match;
  const table = databases[currentDbName].tables[tableName];

  if (!table) {
    return { output: `Error: Table '${tableName}' does not exist in database '${currentDbName}'.` };
  }

  let selectedData = [...table.data]; // Start with all data

  // Basic WHERE clause parsing: colName = 'value' or colName = number
  if (whereClauseStr) {
    const whereMatch = whereClauseStr.match(/(\w+)\s*=\s*(?:'([^']*)'|"([^"]*)"|(\S+))/);
    if (whereMatch) {
      const [, colName, strValue1, strValue2, numOrUnquotedValue] = whereMatch;
      const filterValueStr = strValue1 || strValue2 || numOrUnquotedValue;
      
      const colDef = table.parsedColumns.find(c => c.name.toLowerCase() === colName.toLowerCase());
      if (!colDef) {
        return { output: `Error: Column '${colName}' not found in WHERE clause for table '${tableName}'.` };
      }

      let filterValue: any = filterValueStr;
      if (colDef.type.startsWith('INT') || colDef.type.startsWith('INTEGER')) {
        filterValue = parseInt(filterValueStr, 10);
        if (isNaN(filterValue)) {
           return { output: `Error: Invalid number for comparison in WHERE clause for column '${colName}'.` };
        }
      }
      
      selectedData = selectedData.filter(row => {
        // Handle potential case differences in row keys if necessary, though parsedColumns should be consistent
        const rowValue = row[colDef.name]; 
        return rowValue === filterValue;
      });
    } else {
      return { output: `Error: Unsupported WHERE clause format. Use 'column = value' or 'column = "text value"'.` };
    }
  }

  if (selectedData.length === 0) {
    return { output: "Empty set" };
  }

  // Column projection
  const requestedColumns = columnsStr.trim() === '*' 
    ? table.parsedColumns.map(c => c.name) 
    : columnsStr.split(',').map(c => c.trim());
  
  const headers = requestedColumns.filter(rcName => 
    table.parsedColumns.some(pc => pc.name.toLowerCase() === rcName.toLowerCase())
  );
  
  if (headers.length === 0 && columnsStr.trim() !== '*') {
    return { output: `Error: None of the requested columns (${columnsStr}) found in table '${tableName}'.`};
  }
  
  const finalRows = selectedData.map(row => 
    headers.map(header => row[header] ?? null) // Ensure header exists in row, provide null if not (shouldn't happen with good data)
  );

  return { output: formatTableOutput(headers, finalRows.map(row => row.map(cell => String(cell)))) };
};

