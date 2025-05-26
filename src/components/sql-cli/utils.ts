
import type { DatabasesStructure, TableSchema, DatabaseSchema, ColumnDefinition } from './types';

export const parseCommand = (command: string): { commandName: string; args: string[] } => {
  const parts = command.trim().split(/\s+/);
  return {
    commandName: parts[0]?.toUpperCase() || '',
    args: parts.slice(1),
  };
};

const formatTableOutput = (headers: string[], rows: string[][]): string[] => {
  if (rows.length === 0 && headers.length === 1 && headers[0] !== 'Field Definition' && !headers[0].startsWith('Tables_in_')) {
    return ["Empty set"];
  }
   if (rows.length === 0 && headers.length === 1 && headers[0].startsWith('Tables_in_')) {
    return [`Empty set (0 tables in ${headers[0].substring('Tables_in_'.length)})`];
  }
  if (rows.length === 0 && headers.length > 0 && headers[0] === 'Database') {
     return ["Empty set (0 databases)"];
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
    return formatTableOutput([`Tables_in_${currentDbName}`], []); // Use formatTableOutput for consistency
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

  const values = valuesStr.split(',').map(v => v.trim().replace(/^['"](.*)['"]$/, '$1').replace(/^'(.*)'$/, '$1'));


  let targetColumns: ColumnDefinition[];
  if (columnNamesStr) {
    const specifiedColumnNames = columnNamesStr.split(',').map(name => name.trim());
    targetColumns = [];
    for (const name of specifiedColumnNames) {
        const colDef = table.parsedColumns.find(c => c.name.toLowerCase() === name.toLowerCase());
        if (!colDef) {
             return { output: `Error: Column '${name}' not found in table '${tableName}'.` };
        }
        targetColumns.push(colDef);
    }
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

      if (value === 'NULL') {
        value = null;
      } else if (colDef.type.startsWith('INT') || colDef.type.startsWith('INTEGER') || colDef.type.startsWith('NUMBER')) {
        const num = parseInt(value, 10);
        if (isNaN(num)) {
          return { output: `Error: Invalid integer value '${values[i]}' for column '${colDef.name}'.` };
        }
        value = num;
      } // Add more type coercions if needed (e.g., BOOLEAN, DATE)
      else if (colDef.type.startsWith('FLOAT') || colDef.type.startsWith('DOUBLE') || colDef.type.startsWith('REAL')) {
        const num = parseFloat(value);
        if (isNaN(num)) {
          return { output: `Error: Invalid float value '${values[i]}' for column '${colDef.name}'.` };
        }
        value = num;
      }
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


const parseWhereClause = (whereClauseStr: string | undefined, table: TableSchema): ((row: Record<string, any>) => boolean) | string => {
  if (!whereClauseStr) {
    return () => true; // No WHERE clause means all rows match
  }

  // Basic WHERE clause parsing: colName = 'value' or colName = number or colName = "value"
  // More complex conditions (AND, OR, LIKE, >, <, etc.) are not supported yet.
  const whereMatch = whereClauseStr.match(/(\w+)\s*=\s*(?:'([^']*)'|"([^"]*)"|(\S+))/);
  if (whereMatch) {
    const [, colName, strValueSingleQuote, strValueDoubleQuote, unquotedValue] = whereMatch;
    const filterValueStr = strValueSingleQuote ?? strValueDoubleQuote ?? unquotedValue;
    
    const colDef = table.parsedColumns.find(c => c.name.toLowerCase() === colName.toLowerCase());
    if (!colDef) {
      return `Error: Column '${colName}' not found in WHERE clause for table '${table.columnsDefinition}'.`; // Table name not directly available here easily
    }

    let filterValue: any = filterValueStr;
    if (filterValueStr === 'NULL') {
      filterValue = null;
    } else if (colDef.type.startsWith('INT') || colDef.type.startsWith('INTEGER') || colDef.type.startsWith('NUMBER')) {
      filterValue = parseInt(filterValueStr, 10);
      if (isNaN(filterValue)) {
         return `Error: Invalid number for comparison in WHERE clause for column '${colName}'.`;
      }
    } else if (colDef.type.startsWith('FLOAT') || colDef.type.startsWith('DOUBLE') || colDef.type.startsWith('REAL')) {
        filterValue = parseFloat(filterValueStr);
        if (isNaN(filterValue)) {
           return `Error: Invalid float for comparison in WHERE clause for column '${colName}'.`;
        }
    }
    
    return (row: Record<string, any>) => {
      const rowValue = row[colDef.name];
      return rowValue === filterValue;
    };
  } else {
    return `Error: Unsupported WHERE clause format. Use 'column = value' or 'column = "text value"' or column = 'text value'.`;
  }
};


export const handleSelectData = (
  fullCommand: string,
  currentDbName: string | null,
  databases: DatabasesStructure
): { output: string | string[] } => {
  if (!currentDbName || !databases[currentDbName]) {
    return { output: "Error: No database selected or database does not exist. Use 'USE <database_name>;'." };
  }
  
  const match = fullCommand.match(/^SELECT\s+(.+?)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+WHERE\s+(.+?))?\s*;?$/i);

  if (!match) {
    return { output: "Error: Invalid SELECT syntax. Expected: SELECT columns FROM table_name [WHERE condition];" };
  }

  const [, columnsStr, tableName, whereClauseStr] = match;
  const table = databases[currentDbName].tables[tableName];

  if (!table) {
    return { output: `Error: Table '${tableName}' does not exist in database '${currentDbName}'.` };
  }

  const filterFn = parseWhereClause(whereClauseStr, table);
  if (typeof filterFn === 'string') {
    return { output: filterFn }; // Contains an error message
  }

  const filteredData = table.data.filter(filterFn);

  if (filteredData.length === 0) {
    return { output: "Empty set" };
  }

  const requestedColumns = columnsStr.trim() === '*' 
    ? table.parsedColumns.map(c => c.name) 
    : columnsStr.split(',').map(c => c.trim());
  
  const headers = requestedColumns.filter(rcName => 
    table.parsedColumns.some(pc => pc.name.toLowerCase() === rcName.toLowerCase())
  );
  
  if (headers.length === 0 && columnsStr.trim() !== '*') {
    return { output: `Error: None of the requested columns (${columnsStr}) found in table '${tableName}'.`};
  }
  
  const finalRows = filteredData.map(row => 
    headers.map(header => row[header] ?? 'NULL') 
  );

  return { output: formatTableOutput(headers, finalRows.map(row => row.map(cell => String(cell)))) };
};


export const handleDropTable = (
  tableName: string,
  currentDbName: string | null,
  databases: DatabasesStructure
): { newDatabases?: DatabasesStructure; output: string } => {
  if (!currentDbName || !databases[currentDbName]) {
    return { output: "Error: No database selected or database does not exist." };
  }
  if (!databases[currentDbName].tables[tableName]) {
    return { output: `Error: Table '${tableName}' does not exist in database '${currentDbName}'.` };
  }

  const newDatabases = JSON.parse(JSON.stringify(databases)); // Deep copy
  delete newDatabases[currentDbName].tables[tableName];

  return { newDatabases, output: `Table '${tableName}' dropped successfully.` };
};

export const handleDropDatabase = (
  dbNameToDrop: string,
  currentDbName: string | null,
  databases: DatabasesStructure
): { newDatabases?: DatabasesStructure; newCurrentDb?: string | null; output: string } => {
  if (!databases[dbNameToDrop]) {
    return { output: `Error: Database '${dbNameToDrop}' does not exist.` };
  }

  const newDatabases = JSON.parse(JSON.stringify(databases)); // Deep copy
  delete newDatabases[dbNameToDrop];

  let newCurrentDb = currentDbName;
  if (currentDbName === dbNameToDrop) {
    newCurrentDb = null;
  }

  return { newDatabases, newCurrentDb, output: `Database '${dbNameToDrop}' dropped successfully.` };
};

export const handleDeleteData = (
  fullCommand: string,
  currentDbName: string | null,
  databases: DatabasesStructure
): { newDatabases?: DatabasesStructure; output: string } => {
  if (!currentDbName || !databases[currentDbName]) {
    return { output: "Error: No database selected or database does not exist." };
  }

  const match = fullCommand.match(/^DELETE\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+WHERE\s+(.+?))?\s*;?$/i);
  if (!match) {
    return { output: "Error: Invalid DELETE syntax. Expected: DELETE FROM table_name [WHERE condition];" };
  }

  const [, tableName, whereClauseStr] = match;
  const table = databases[currentDbName].tables[tableName];

  if (!table) {
    return { output: `Error: Table '${tableName}' does not exist in database '${currentDbName}'.` };
  }

  const filterFn = parseWhereClause(whereClauseStr, table);
  if (typeof filterFn === 'string') {
    return { output: filterFn }; // Error message from parseWhereClause
  }

  let deletedCount = 0;
  const newData = table.data.filter(row => {
    if (filterFn(row)) {
      deletedCount++;
      return false; // Don't keep if matches
    }
    return true; // Keep if doesn't match
  });

  const newDatabases = JSON.parse(JSON.stringify(databases));
  newDatabases[currentDbName].tables[tableName].data = newData;

  return { newDatabases, output: `${deletedCount} row(s) deleted from '${tableName}'.` };
};

export const handleUpdateData = (
  fullCommand: string,
  currentDbName: string | null,
  databases: DatabasesStructure
): { newDatabases?: DatabasesStructure; output: string } => {
  if (!currentDbName || !databases[currentDbName]) {
    return { output: "Error: No database selected or database does not exist." };
  }

  const match = fullCommand.match(/^UPDATE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+?))?\s*;?$/i);
  if (!match) {
    return { output: "Error: Invalid UPDATE syntax. Expected: UPDATE table_name SET col1 = val1, ... [WHERE condition];" };
  }

  const [, tableName, setClauseStr, whereClauseStr] = match;
  const table = databases[currentDbName].tables[tableName];

  if (!table) {
    return { output: `Error: Table '${tableName}' does not exist in database '${currentDbName}'.` };
  }

  const setAssignments: Array<{ column: string; value: any }> = [];
  const setParts = setClauseStr.split(',').map(p => p.trim());

  for (const part of setParts) {
    const assignMatch = part.match(/(\w+)\s*=\s*(?:'([^']*)'|"([^"]*)"|(\S+))/);
    if (!assignMatch) {
      return { output: `Error: Invalid SET assignment: '${part}'. Expected format: column = value.` };
    }
    const [, columnName, strValueSingle, strValueDouble, unquotedValue] = assignMatch;
    let valueStr = strValueSingle ?? strValueDouble ?? unquotedValue;

    const colDef = table.parsedColumns.find(c => c.name.toLowerCase() === columnName.toLowerCase());
    if (!colDef) {
      return { output: `Error: Column '${columnName}' not found in table '${tableName}' for SET clause.` };
    }
    
    let value: any = valueStr;
    if (valueStr.toUpperCase() === 'NULL') {
        value = null;
    } else if (colDef.type.startsWith('INT') || colDef.type.startsWith('INTEGER') || colDef.type.startsWith('NUMBER')) {
      value = parseInt(valueStr, 10);
      if (isNaN(value)) return { output: `Error: Invalid integer value '${valueStr}' for column '${columnName}'.` };
    } else if (colDef.type.startsWith('FLOAT') || colDef.type.startsWith('DOUBLE') || colDef.type.startsWith('REAL')) {
      value = parseFloat(valueStr);
      if (isNaN(value)) return { output: `Error: Invalid float value '${valueStr}' for column '${columnName}'.` };
    } else if (colDef.type.startsWith('VARCHAR') || colDef.type.startsWith('TEXT') || colDef.type.startsWith('CHAR')) {
       // Value is already a string, potentially stripped of outer quotes by regex if they were present
    }
    setAssignments.push({ column: colDef.name, value });
  }

  if (setAssignments.length === 0) {
    return { output: "Error: No valid SET assignments found." };
  }

  const filterFn = parseWhereClause(whereClauseStr, table);
  if (typeof filterFn === 'string') {
    return { output: filterFn }; // Error message
  }

  let updatedCount = 0;
  const newData = table.data.map(row => {
    if (filterFn(row)) {
      updatedCount++;
      const newRow = { ...row };
      setAssignments.forEach(assign => {
        newRow[assign.column] = assign.value;
      });
      return newRow;
    }
    return row;
  });

  const newDatabases = JSON.parse(JSON.stringify(databases));
  newDatabases[currentDbName].tables[tableName].data = newData;

  return { newDatabases, output: `${updatedCount} row(s) updated in '${tableName}'.` };
};
