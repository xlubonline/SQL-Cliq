
import type { DatabasesStructure, TableSchema, DatabaseSchema, ColumnDefinition } from './types';
import crypto from 'crypto';

// Password Hashing Utilities
function hashPassword(password: string): string {
  if (!password) return ''; // Should not happen if validated before
  return crypto.createHash('sha256').update(password).digest('hex');
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (!password || !storedHash) return false;
  return hashPassword(password) === storedHash;
}

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
    if (headers.length > 0 && headers[0] === 'Field') { 
        return ["Table has no columns or definition is malformed."];
    }
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

export const parseColumnDefinitions = (definitionStr: string): ColumnDefinition[] => {
  if (!definitionStr) return [];
  const columns: ColumnDefinition[] = [];
  // Regex to split by comma, but not if comma is inside parentheses (e.g., for VARCHAR(255))
  const defs = definitionStr.split(/,(?![^()]*\))/g); 
  
  const constraintKeywords = ['PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'CHECK', 'CONSTRAINT'];

  defs.forEach(def => {
    const trimmedDef = def.trim();
    if (!trimmedDef) return;

    // Check if this definition part starts with a known table-level constraint keyword
    const isTableConstraint = constraintKeywords.some(keyword => 
      trimmedDef.toUpperCase().startsWith(keyword)
    );

    if (isTableConstraint) {
      return; // Skip table-level constraints for parsedColumns list used by INSERT value counting
    }

    // Attempt to parse as 'column_name type_definition'
    // This regex captures a valid SQL-like identifier as name, and the rest as type.
    const parts = trimmedDef.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(.+)$/i); 
    if (parts && parts.length === 3) {
      // parts[1] is column name, parts[2] is type and any inline constraints
      columns.push({ name: parts[1].trim(), type: parts[2].trim().toUpperCase() });
    } else {
      // This might happen with definitions that are not simple 'name type' or are malformed.
      // For this CLI, we'll ignore them if they don't fit and weren't caught as table constraints.
      console.warn(`Could not parse "${trimmedDef}" as a column definition (name type). It will be ignored for data column counting.`);
    }
  });
  return columns;
};


const isValidIdentifier = (name: string): boolean => {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}


export const handleCreateDatabase = (
  fullCommand: string, // Changed to full command string
  databases: DatabasesStructure
): { newDatabases: DatabasesStructure; output: string } => {
  // Regex to match CREATE DATABASE db_name [WITH PASSWORD 'password_value']
  const createDbRegex = /^CREATE\s+DATABASE\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+WITH\s+PASSWORD\s+'([^']*)')?\s*;?$/i;
  const match = fullCommand.match(createDbRegex);

  if (!match) {
    return { newDatabases: databases, output: "Error: Invalid CREATE DATABASE syntax. Expected: CREATE DATABASE <db_name> [WITH PASSWORD '<password>'];" };
  }

  const dbName = match[1];
  const password = match[2]; // This will be undefined if password clause is not present

  if (!dbName || !isValidIdentifier(dbName)) {
    return { newDatabases: databases, output: `Error: Invalid database name '${dbName}'. Names must start with a letter or underscore, followed by letters, numbers, or underscores.` };
  }
  if (databases[dbName]) {
    return { newDatabases: databases, output: `Error: Database '${dbName}' already exists.` };
  }

  let passwordHash: string | undefined = undefined;
  if (password) {
    if (password.length < 4) { // Basic validation
        return { newDatabases: databases, output: `Error: Password for database '${dbName}' must be at least 4 characters long.` };
    }
    passwordHash = hashPassword(password);
  }

  const newDbSchema: DatabaseSchema = { tables: {} };
  if (passwordHash) {
    newDbSchema.passwordHash = passwordHash;
  }

  const newDatabases = { ...databases, [dbName]: newDbSchema };
  let outputMessage = `Database '${dbName}' created successfully.`;
  if (passwordHash) {
    outputMessage += " It is password protected.";
  }
  return { newDatabases, output: outputMessage };
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
): { newCurrentDb?: string | null; output: string | string[]; requiresPasswordInput?: boolean; dbToAuth?: string } => {
  if (!databases[dbName]) {
    return { output: `Error: Unknown database '${dbName}'.` };
  }
  
  const dbSchema = databases[dbName];
  if (dbSchema.passwordHash) {
    return { 
      output: [`Password required for database '${dbName}'.`, "Enter password on the next line:"], 
      requiresPasswordInput: true, 
      dbToAuth: dbName 
    };
  }

  return { newCurrentDb: dbName, output: `Database changed to '${dbName}'.` };
};

export const handlePasswordAttempt = (
  dbName: string,
  enteredPassword: string,
  databases: DatabasesStructure
): { newCurrentDb: string | null; output: string } => {
  const dbSchema = databases[dbName];
  if (!dbSchema || !dbSchema.passwordHash) {
    // This case should not be reached if logic is correct, as USE would have switched already
    return { newCurrentDb: null, output: `Error: Database '${dbName}' is not password protected or does not exist.` };
  }

  if (verifyPassword(enteredPassword, dbSchema.passwordHash)) {
    return { newCurrentDb: dbName, output: `Access granted. Database changed to '${dbName}'.` };
  } else {
    return { newCurrentDb: null, output: `Error: Invalid password for database '${dbName}'. Access denied.` };
  }
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

  if (!tableName || !isValidIdentifier(tableName)) {
     return { newDatabases: databases, output: `Error: Invalid table name '${tableName}'.` };
  }
  
  if (databases[currentDbName]?.tables[tableName]) {
    return { newDatabases: databases, output: `Error: Table '${tableName}' already exists in database '${currentDbName}'.` };
  }

  const parsedColumns = parseColumnDefinitions(columnsDefinitionStr.trim());
  if (parsedColumns.length === 0 && columnsDefinitionStr.trim() !== "") { 
    // Check if the definition string only contained constraints or was genuinely empty for columns
    const onlyConstraintsOrEmpty = columnsDefinitionStr.trim().split(/,(?![^()]*\))/g)
        .every(def => {
            const trimmedDef = def.trim().toUpperCase();
            return !trimmedDef || ['PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE', 'CHECK', 'CONSTRAINT'].some(kw => trimmedDef.startsWith(kw));
        });
    if (!onlyConstraintsOrEmpty) {
      return { newDatabases: databases, output: `Error: Could not parse any valid column definitions for table '${tableName}'. Ensure format is 'colName TYPE, ...'. Problem with: "${columnsDefinitionStr.trim()}"`};
    }
  }
  if (parsedColumns.some(pc => !pc.name || !pc.type)) {
     return { newDatabases: databases, output: `Error: Invalid column definition syntax in '${columnsDefinitionStr.trim()}'. Each column must have a name and a type.` };
  }


  const newTable: TableSchema = { 
    columnsDefinition: columnsDefinitionStr.trim(),
    parsedColumns,
    data: [] 
  };
  const updatedDb: DatabaseSchema = {
    ...databases[currentDbName],
    tables: {
      ...(databases[currentDbName]?.tables || {}), 
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
    return formatTableOutput([`Tables_in_${currentDbName}`], []); 
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
  // parsedColumns should now correctly list only data columns
  const rows = table.parsedColumns.map(col => [col.name, col.type.toUpperCase()]);
  
  if (rows.length === 0) {
     return formatTableOutput(headers, []); 
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

  const values = valuesStr.split(',').map(v => {
    const trimmedV = v.trim();
    if (trimmedV.toUpperCase() === 'NULL') return null;
    // Handle smart quotes and standard quotes for strings
    if ((trimmedV.startsWith("'") && trimmedV.endsWith("'")) || 
        (trimmedV.startsWith('"') && trimmedV.endsWith('"')) ||
        (trimmedV.startsWith("’") && trimmedV.endsWith("’")) ) {
      return trimmedV.substring(1, trimmedV.length - 1);
    }
    return trimmedV;
  });


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
    targetColumns = table.parsedColumns; // This list should now be correct
  }
  
  if (values.length !== targetColumns.length) {
    return { output: `Error: Column count (${targetColumns.length}) does not match value count (${values.length}). Expected ${targetColumns.length} values for columns: ${targetColumns.map(c => c.name).join(', ')}.` };
  }

  const newRow: Record<string, any> = {};
  try {
    for (let i = 0; i < targetColumns.length; i++) {
      const colDef = targetColumns[i];
      let value: any = values[i];

      if (value === null) { 
        newRow[colDef.name] = null;
        continue;
      }
      
      const colTypeUpper = colDef.type.toUpperCase();

      if (colTypeUpper.startsWith('INT') || colTypeUpper.startsWith('INTEGER') || colTypeUpper.startsWith('NUMBER')) {
        const num = parseInt(value, 10);
        if (isNaN(num)) {
          return { output: `Error: Invalid integer value '${values[i]}' for column '${colDef.name}'.` };
        }
        value = num;
      } 
      else if (colTypeUpper.startsWith('FLOAT') || colTypeUpper.startsWith('DOUBLE') || colTypeUpper.startsWith('REAL')) {
        const num = parseFloat(value);
        if (isNaN(num)) {
          return { output: `Error: Invalid float value '${values[i]}' for column '${colDef.name}'.` };
        }
        value = num;
      }
      // For VARCHAR, TEXT, etc., the value is already a string or has been converted.
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
    return () => true; 
  }

  // Match 'column = value' or 'column = "text value"' or 'column = 'text value''
  // Handles smart quotes as well
  const whereMatch = whereClauseStr.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:'([^']*)'|"([^"]*)"|’([^’]*)’|(\S+))/i);

  if (whereMatch) {
    const [, colName, strValueSingleQuote, strValueDoubleQuote, strValueSmartQuote, unquotedValue] = whereMatch;
    
    const colDef = table.parsedColumns.find(c => c.name.toLowerCase() === colName.toLowerCase());
    if (!colDef) {
      return `Error: Column '${colName}' not found in WHERE clause for table. Available columns: ${table.parsedColumns.map(c=>c.name).join(', ')}.`;
    }

    let filterValueStr = strValueSingleQuote ?? strValueDoubleQuote ?? strValueSmartQuote ?? unquotedValue;
    let filterValue: any;

    if (filterValueStr.toUpperCase() === 'NULL') {
      filterValue = null;
    } else {
      const colTypeUpper = colDef.type.toUpperCase();
      if (colTypeUpper.startsWith('INT') || colTypeUpper.startsWith('INTEGER') || colTypeUpper.startsWith('NUMBER')) {
        filterValue = parseInt(filterValueStr, 10);
        if (isNaN(filterValue)) {
           return `Error: Invalid number for comparison in WHERE clause for column '${colName}'. Value was '${filterValueStr}'.`;
        }
      } else if (colTypeUpper.startsWith('FLOAT') || colTypeUpper.startsWith('DOUBLE') || colTypeUpper.startsWith('REAL')) {
          filterValue = parseFloat(filterValueStr);
          if (isNaN(filterValue)) {
             return `Error: Invalid float for comparison in WHERE clause for column '${colName}'. Value was '${filterValueStr}'.`;
          }
      } else { 
        filterValue = filterValueStr; 
      }
    }
    
    return (row: Record<string, any>) => {
      const rowValue = row[colDef.name];
      // Type-aware comparison for numbers, case-insensitive for strings
      if (typeof filterValue === 'number' && typeof rowValue === 'number') {
        return rowValue === filterValue;
      }
      if (typeof filterValue === 'string' && typeof rowValue === 'string') {
        return rowValue.toLowerCase() === filterValue.toLowerCase();
      }
      return rowValue === filterValue; // Fallback for other types or null
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
  
  const match = fullCommand.match(/^SELECT\s+(.+?)\s+FROM\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+(ASC|DESC))?)?(?:\s+LIMIT\s+(\d+))?\s*;?$/i);

  if (!match) {
    return { output: "Error: Invalid SELECT syntax. Expected: SELECT columns FROM table_name [WHERE condition] [ORDER BY column [ASC|DESC]] [LIMIT number];" };
  }

  const [, columnsStr, tableName, whereClauseStr, orderByColumnName, orderByDirectionStr, limitCountStr] = match;
  const table = databases[currentDbName].tables[tableName];

  if (!table) {
    return { output: `Error: Table '${tableName}' does not exist in database '${currentDbName}'.` };
  }

  const filterFn = parseWhereClause(whereClauseStr, table);
  if (typeof filterFn === 'string') {
    return { output: filterFn }; 
  }

  let processedData = table.data.filter(filterFn);

  if (orderByColumnName) {
    const orderByColumnFound = table.parsedColumns.find(c => c.name.toLowerCase() === orderByColumnName.toLowerCase());
    if (!orderByColumnFound) {
      return { output: `Error: Column '${orderByColumnName}' not found in table '${tableName}' for ORDER BY clause.` };
    }
    const effectiveOrderByDirection = orderByDirectionStr?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

    processedData.sort((rowA, rowB) => {
      let valA = rowA[orderByColumnFound.name];
      let valB = rowB[orderByColumnFound.name];

      if (valA === null && valB !== null) return effectiveOrderByDirection === 'ASC' ? -1 : 1;
      if (valA !== null && valB === null) return effectiveOrderByDirection === 'ASC' ? 1 : -1;
      if (valA === null && valB === null) return 0;
      
      const colTypeUpper = orderByColumnFound.type.toUpperCase();
      if (colTypeUpper.startsWith('INT') || colTypeUpper.startsWith('INTEGER') || colTypeUpper.startsWith('NUMBER')) {
        valA = parseInt(String(valA), 10);
        valB = parseInt(String(valB), 10);
      } else if (colTypeUpper.startsWith('FLOAT') || colTypeUpper.startsWith('DOUBLE') || colTypeUpper.startsWith('REAL')) {
        valA = parseFloat(String(valA));
        valB = parseFloat(String(valB));
      } else {
        valA = String(valA).toLowerCase();
        valB = String(valB).toLowerCase();
      }

      if (typeof valA === 'number' && isNaN(valA) && (typeof valB !== 'number' || !isNaN(valB))) return effectiveOrderByDirection === 'ASC' ? -1 : 1;
      if ((typeof valA !== 'number' || !isNaN(valA)) && typeof valB === 'number' && isNaN(valB)) return effectiveOrderByDirection === 'ASC' ? 1 : -1;
      if (typeof valA === 'number' && isNaN(valA) && typeof valB === 'number' && isNaN(valB)) return 0;


      if (valA < valB) return effectiveOrderByDirection === 'ASC' ? -1 : 1;
      if (valA > valB) return effectiveOrderByDirection === 'ASC' ? 1 : -1;
      return 0;
    });
  }

  if (limitCountStr) {
    const limit = parseInt(limitCountStr, 10);
    if (!isNaN(limit) && limit > 0) {
      processedData = processedData.slice(0, limit);
    } else if (!isNaN(limit) && limit === 0) {
      processedData = []; 
    }
  }


  if (processedData.length === 0) {
    return { output: "Empty set" };
  }

  const requestedColumns = columnsStr.trim() === '*' 
    ? table.parsedColumns.map(c => c.name) 
    : columnsStr.split(',').map(c => c.trim());
  
  const headers = requestedColumns.filter(rcName => 
    table.parsedColumns.some(pc => pc.name.toLowerCase() === rcName.toLowerCase())
  ).map(rcName => { // Ensure headers retain original casing from parsedColumns
    const foundCol = table.parsedColumns.find(pc => pc.name.toLowerCase() === rcName.toLowerCase());
    return foundCol ? foundCol.name : rcName;
  });
  
  if (headers.length === 0 && columnsStr.trim() !== '*') {
    return { output: `Error: None of the requested columns (${columnsStr}) found in table '${tableName}'. Available: ${table.parsedColumns.map(c => c.name).join(', ')}`};
  }
  
  const finalRows = processedData.map(row => 
    headers.map(header => {
      const val = row[header]; // Use the correctly cased header
      return val === null ? 'NULL' : String(val);
    }) 
  );

  return { output: formatTableOutput(headers, finalRows) };
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

  const newDatabases = JSON.parse(JSON.stringify(databases)); 
  delete newDatabases[currentDbName].tables[tableName];

  return { newDatabases, output: `Table '${tableName}' dropped successfully.` };
};

export const handleDropDatabase = (
  dbNameToDrop: string,
  currentDbName: string | null,
  databases: DatabasesStructure
): { 
  newDatabases?: DatabasesStructure; 
  newCurrentDb?: string | null; 
  output: string | string[]; 
  requiresPasswordInputForDrop?: boolean; 
  dbToAuthForDrop?: string 
} => {
  if (!databases[dbNameToDrop]) {
    return { output: `Error: Database '${dbNameToDrop}' does not exist.` };
  }

  const dbSchema = databases[dbNameToDrop];
  if (dbSchema.passwordHash && currentDbName !== dbNameToDrop) {
    // It's password protected AND it's not the current database (password wasn't entered via USE for this db)
    return { 
      output: [`Password required to drop database '${dbNameToDrop}'.`, "Enter password on the next line:"], 
      requiresPasswordInputForDrop: true, 
      dbToAuthForDrop: dbNameToDrop 
    };
  }

  // If not password protected, OR if it is protected but IS the currentDbName (password already verified)
  // Proceed with dropping directly
  const newDatabases = JSON.parse(JSON.stringify(databases)); 
  delete newDatabases[dbNameToDrop];

  let newCurrentDb = currentDbName;
  if (currentDbName === dbNameToDrop) {
    newCurrentDb = null;
  }

  return { newDatabases, newCurrentDb, output: `Database '${dbNameToDrop}' dropped successfully.` };
};

export const handlePasswordAttemptAndDropDatabase = (
  dbNameToDrop: string,
  enteredPassword: string,
  currentDbName: string | null,
  databases: DatabasesStructure
): { newDatabases?: DatabasesStructure; newCurrentDb?: string | null; output: string } => {
  const dbSchema = databases[dbNameToDrop];
  if (!dbSchema || !dbSchema.passwordHash) {
    // Should not happen if requiresPasswordInputForDrop was true
    return { output: `Error: Database '${dbNameToDrop}' is not password protected or does not exist.` };
  }

  if (verifyPassword(enteredPassword, dbSchema.passwordHash)) {
    const newDatabases = JSON.parse(JSON.stringify(databases));
    delete newDatabases[dbNameToDrop];

    let newCurrentDb = currentDbName;
    if (currentDbName === dbNameToDrop) {
      newCurrentDb = null;
    }
    return { newDatabases, newCurrentDb, output: `Database '${dbNameToDrop}' dropped successfully.` };
  } else {
    return { output: `Error: Invalid password for dropping database '${dbNameToDrop}'. Drop failed.` };
  }
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
    return { output: filterFn }; 
  }

  let deletedCount = 0;
  const newData = table.data.filter(row => {
    if (filterFn(row)) {
      deletedCount++;
      return false; 
    }
    return true; 
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
    const assignMatch = part.match(/([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(?:'([^']*)'|"([^"]*)"|’([^’]*)’|(\S+))/i);
    if (!assignMatch) {
      return { output: `Error: Invalid SET assignment: '${part}'. Expected format: column = value.` };
    }
    const [, columnName, strValueSingle, strValueDouble, strValueSmart, unquotedValue] = assignMatch;
    

    const colDef = table.parsedColumns.find(c => c.name.toLowerCase() === columnName.toLowerCase());
    if (!colDef) {
      return { output: `Error: Column '${columnName}' not found in table '${tableName}' for SET clause.` };
    }
    
    let valueStr = strValueSingle ?? strValueDouble ?? strValueSmart ?? unquotedValue;
    let value: any;

    if (valueStr.toUpperCase() === 'NULL') {
        value = null;
    } else {
        const colTypeUpper = colDef.type.toUpperCase();
        if (colTypeUpper.startsWith('INT') || colTypeUpper.startsWith('INTEGER') || colTypeUpper.startsWith('NUMBER')) {
          value = parseInt(valueStr, 10);
          if (isNaN(value)) return { output: `Error: Invalid integer value '${valueStr}' for column '${columnName}'.` };
        } else if (colTypeUpper.startsWith('FLOAT') || colTypeUpper.startsWith('DOUBLE') || colTypeUpper.startsWith('REAL')) {
          value = parseFloat(valueStr);
          if (isNaN(value)) return { output: `Error: Invalid float value '${valueStr}' for column '${columnName}'.` };
        } else { 
           value = valueStr; 
        }
    }
    setAssignments.push({ column: colDef.name, value });
  }

  if (setAssignments.length === 0) {
    return { output: "Error: No valid SET assignments found." };
  }

  const filterFn = parseWhereClause(whereClauseStr, table);
  if (typeof filterFn === 'string') {
    return { output: filterFn }; 
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

export const handleAlterTableAddColumn = (
  fullCommandArgs: string[], 
  currentDbName: string | null,
  databases: DatabasesStructure
): { newDatabases?: DatabasesStructure; output: string } => {
  if (!currentDbName || !databases[currentDbName]) {
    return { output: "Error: No database selected or database does not exist." };
  }

  // fullCommandArgs will be like ['TABLE', 'my_table', 'ADD', 'COLUMN', 'new_col', 'INT', 'NOT', 'NULL']
  // We need at least 5 parts: TABLE <name> ADD COLUMN <col_name> <col_type>
  if (fullCommandArgs.length < 5 || fullCommandArgs[0]?.toUpperCase() !== 'TABLE' || fullCommandArgs[2]?.toUpperCase() !== 'ADD' || fullCommandArgs[3]?.toUpperCase() !== 'COLUMN') {
    return { output: "Error: Invalid ALTER TABLE syntax. Expected: ALTER TABLE <table_name> ADD COLUMN <col_name> <col_type_definition>;" };
  }
  
  const tableName = fullCommandArgs[1];
  const columnName = fullCommandArgs[4];
  // Column type definition can be multiple words (e.g., VARCHAR(255) NOT NULL)
  const columnTypeDefinition = fullCommandArgs.slice(5).join(' ').replace(/;/g, '');


  if (!tableName || !isValidIdentifier(tableName)) {
    return { output: `Error: Invalid table name '${tableName}' in ALTER TABLE command.` };
  }
  if (!columnName || !isValidIdentifier(columnName)) {
    return { output: `Error: Invalid new column name '${columnName}'.` };
  }
  if (!columnTypeDefinition) {
    return { output: `Error: Missing column type definition for new column '${columnName}'.` };
  }

  const table = databases[currentDbName].tables[tableName];
  if (!table) {
    return { output: `Error: Table '${tableName}' does not exist in database '${currentDbName}'.` };
  }

  if (table.parsedColumns.some(col => col.name.toLowerCase() === columnName.toLowerCase())) {
    return { output: `Error: Column '${columnName}' already exists in table '${tableName}'.` };
  }

  const newColumnDefParts = parseColumnDefinitions(`${columnName} ${columnTypeDefinition}`);
  if (newColumnDefParts.length === 0 || !newColumnDefParts[0].name || !newColumnDefParts[0].type) {
      return { output: `Error: Could not parse new column definition: '${columnName} ${columnTypeDefinition}'. Ensure it is in 'name TYPE' format.`};
  }
  const newColumnDef = newColumnDefParts[0];

  const newDatabases = JSON.parse(JSON.stringify(databases));
  const tableToUpdate = newDatabases[currentDbName].tables[tableName];

  tableToUpdate.parsedColumns.push(newColumnDef);
  tableToUpdate.columnsDefinition = tableToUpdate.columnsDefinition 
    ? `${tableToUpdate.columnsDefinition}, ${newColumnDef.name} ${newColumnDef.type}` 
    : `${newColumnDef.name} ${newColumnDef.type}`;
  
  tableToUpdate.data.forEach((row: Record<string, any>) => {
    row[newColumnDef.name] = null; 
  });

  return { newDatabases, output: `Column '${columnName}' added to table '${tableName}'.` };
};

export const handleRenameTable = (
  oldTableName: string,
  newTableName: string,
  currentDbName: string | null,
  databases: DatabasesStructure
): { newDatabases?: DatabasesStructure; output: string } => {
  if (!currentDbName || !databases[currentDbName]) {
    return { output: "Error: No database selected or database does not exist." };
  }

  const currentDbSchema = databases[currentDbName];
  if (!currentDbSchema.tables[oldTableName]) {
    return { output: `Error: Table '${oldTableName}' does not exist in database '${currentDbName}'.` };
  }
  if (currentDbSchema.tables[newTableName]) {
    return { output: `Error: Table '${newTableName}' already exists in database '${currentDbName}'.` };
  }
  if (!isValidIdentifier(newTableName)) {
    return { output: `Error: Invalid new table name '${newTableName}'. Names must start with a letter or underscore, followed by letters, numbers, or underscores.` };
  }

  const newDatabases = JSON.parse(JSON.stringify(databases)); 
  const tableToRename = newDatabases[currentDbName].tables[oldTableName];
  delete newDatabases[currentDbName].tables[oldTableName];
  newDatabases[currentDbName].tables[newTableName] = tableToRename;

  return { newDatabases, output: `Table '${oldTableName}' renamed to '${newTableName}' successfully.` };
};

// TODO: Add ALTER DATABASE commands for password management if needed.
// e.g., ALTER DATABASE db_name SET PASSWORD 'new_password';
// e.g., ALTER DATABASE db_name REMOVE PASSWORD;


    