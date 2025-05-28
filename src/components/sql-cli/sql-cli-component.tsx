
'use client';

import { getSqlCommand } from '@/ai/flows/sql-syntax-assistance';
import { loadDatabasesAction, saveDatabasesAction } from '@/app/actions/sql-data-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Terminal } from 'lucide-react';
import React, { useState, useEffect, useRef, FormEvent, useCallback } from 'react';
import type { DatabasesStructure, HistoryEntry } from './types';
import { 
  parseCommand, 
  handleCreateDatabase, 
  handleShowDatabases, 
  handleUseDatabase,
  handlePasswordAttempt,
  handleCreateTable,
  handleShowTables,
  handleDescribeTable,
  handleInsertData,
  handleSelectData,
  handleDropTable,
  handleDropDatabase,
  handleUpdateData,
  handleDeleteData,
  handleAlterTableAddColumn,
  handleRenameTable,
  handlePasswordAttemptAndDropDatabase
} from './utils';

const SQL_CLIQ_CURRENT_DB_KEY = 'sqlCliqCurrentDb_v2'; 
const SQL_CLIQ_HISTORY_KEY = 'sqlCliqHistory_v2';     

export function SqlCliComponent() {
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [databases, setDatabases] = useState<DatabasesStructure>({});
  const [currentDatabase, setCurrentDatabase] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isLoadingAssistant, setIsLoadingAssistant] = useState(false);
  const [isSavingData, setIsSavingData] = useState(false);
  const [isLoadingInitialData, setIsLoadingInitialData] = useState(true);
  const [awaitingPasswordForDb, setAwaitingPasswordForDb] = useState<string | null>(null);
  const [awaitingPasswordForDropDb, setAwaitingPasswordForDropDb] = useState<string | null>(null);


  const inputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const addHistoryEntry = useCallback((type: HistoryEntry['type'], content: string | string[], currentPrompt?: string) => {
    setHistory(prev => [...prev, { id: Date.now().toString() + Math.random(), type, content, prompt: currentPrompt }]);
  }, []);

  const initialWelcomeMessages = [
    "Welcome to SQL Cliq!",
    "Type 'ASSIST \"your question\"' for AI help.",
    "Type 'HELP;' for a list of basic commands.",
    "Database data is now saved on the server (simulated).",
    "Databases can be password protected: CREATE DATABASE name WITH PASSWORD 'secret';",
  ];


  useEffect(() => {
    setIsMounted(true);
    
    try {
      const savedHistory = localStorage.getItem(SQL_CLIQ_HISTORY_KEY);
      if (savedHistory) {
        const parsedHistory = JSON.parse(savedHistory);
        if (parsedHistory.length > 0) {
            setHistory(parsedHistory);
        } else {
            addHistoryEntry('output', initialWelcomeMessages);
        }
      } else {
        addHistoryEntry('output', initialWelcomeMessages);
      }
    } catch (error) {
      console.error("Failed to load history from localStorage:", error);
      addHistoryEntry('error', "Error loading command history.");
      addHistoryEntry('output', initialWelcomeMessages);
    }

    try {
      const savedCurrentDb = localStorage.getItem(SQL_CLIQ_CURRENT_DB_KEY);
      if (savedCurrentDb) setCurrentDatabase(savedCurrentDb);
    } catch (error) {
      console.error("Failed to load current database from localStorage:", error);
    }

    const fetchInitialData = async () => {
      setIsLoadingInitialData(true);
      try {
        const serverDatabases = await loadDatabasesAction();
        setDatabases(serverDatabases);
      } catch (error: any) {
        console.error("Failed to load databases from server:", error);
        toast({ title: "Server Error", description: error.message || "Could not load database data.", variant: "destructive" });
        addHistoryEntry('error', `Error: Could not load databases from server. ${error.message}`);
      } finally {
        setIsLoadingInitialData(false);
      }
    };
    fetchInitialData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]); 

  useEffect(() => {
    if (isMounted) {
      if (currentDatabase) {
        localStorage.setItem(SQL_CLIQ_CURRENT_DB_KEY, currentDatabase);
      } else {
        localStorage.removeItem(SQL_CLIQ_CURRENT_DB_KEY);
      }
    }
  }, [currentDatabase, isMounted]);
  
  useEffect(() => {
    if (isMounted) {
      localStorage.setItem(SQL_CLIQ_HISTORY_KEY, JSON.stringify(history));
    }
  }, [history, isMounted]);

  useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector('div[data-radix-scroll-area-viewport]');
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }
    inputRef.current?.focus();
  }, [history, isLoadingAssistant, isSavingData, awaitingPasswordForDb, awaitingPasswordForDropDb]);

  const saveDatabasesToServer = async (updatedDatabases: DatabasesStructure) => {
    setIsSavingData(true);
    try {
      await saveDatabasesAction(updatedDatabases);
    } catch (error: any) {
      console.error("Failed to save databases to server:", error);
      toast({ title: "Server Error", description: error.message || "Could not save database data.", variant: "destructive" });
      addHistoryEntry('error', `Error: Could not save changes to server. ${error.message}`);
    } finally {
      setIsSavingData(false);
    }
  };


  const processCommand = async (fullInputLine: string) => {
    const trimmedFullInputLine = fullInputLine.trim();
    if (!trimmedFullInputLine) return;

    let currentPromptText = getPromptText(); // Use helper for current prompt
    
    addHistoryEntry('input', trimmedFullInputLine, currentPromptText);

    if (awaitingPasswordForDropDb) {
      const dbToDrop = awaitingPasswordForDropDb;
      const password = trimmedFullInputLine;
      setAwaitingPasswordForDropDb(null); // Clear password drop mode

      const dropAuthResult = handlePasswordAttemptAndDropDatabase(dbToDrop, password, currentDatabase, databases);
      
      if (dropAuthResult.newDatabases) { // Successfully dropped
        setDatabases(dropAuthResult.newDatabases);
        if (dropAuthResult.newCurrentDb !== undefined) {
          setCurrentDatabase(dropAuthResult.newCurrentDb);
        }
        await saveDatabasesToServer(dropAuthResult.newDatabases);
      }
      addHistoryEntry(dropAuthResult.output.startsWith('Error:') ? 'error' : 'output', dropAuthResult.output);
      return; // Password attempt for drop processed
    }

    if (awaitingPasswordForDb) {
      const dbToAuth = awaitingPasswordForDb;
      const password = trimmedFullInputLine;
      setAwaitingPasswordForDb(null); // Clear password mode immediately

      const authResult = handlePasswordAttempt(dbToAuth, password, databases);
      if (authResult.newCurrentDb) {
        setCurrentDatabase(authResult.newCurrentDb);
      }
      addHistoryEntry(authResult.output.startsWith('Error:') ? 'error' : 'output', authResult.output);
      return; // Password attempt processed, no further command processing on this line.
    }
    
    if (trimmedFullInputLine.startsWith('--')) {
      addHistoryEntry('comment', trimmedFullInputLine, currentPromptText);
      return;
    }

    const individualCommandStrings = trimmedFullInputLine
      .split(';')
      .map(cmd => cmd.trim())
      .filter(cmd => cmd.length > 0);

    let tempDatabases = { ...databases }; 

    for (const commandStr of individualCommandStrings) {
      if (isLoadingAssistant || isSavingData) continue; 

      const { commandName, args } = parseCommand(commandStr);
      let result: any; // Using 'any' for result due to varying return types
      let needsSave = false;

      if (commandStr.toUpperCase().startsWith('ASSIST ')) {
        const match = commandStr.match(/^ASSIST\s+"([^"]+)"\s*;?$/i) || commandStr.match(/^ASSIST\s+'([^']+)'\s*;?$/i);
        if (match && match[1]) {
          setIsLoadingAssistant(true);
          addHistoryEntry('assist-input', `AI Assistant Request: ${match[1]}`);
          try {
            const aiResponse = await getSqlCommand({ prompt: match[1] });
            addHistoryEntry('assist-output', `AI Suggestion:\n${aiResponse.sqlCommand}`);
          } catch (error) {
            console.error("AI Assistant error:", error);
            addHistoryEntry('error', "Error: AI Assistant failed to respond.");
          } finally {
            setIsLoadingAssistant(false);
          }
          continue; 
        } else {
          addHistoryEntry('error', "Error: Invalid ASSIST syntax. Expected: ASSIST \"your question about SQL\".");
          continue; 
        }
      }
      
      switch (commandName) {
        case 'CREATE':
          if (args[0]?.toUpperCase() === 'DATABASE') {
            result = handleCreateDatabase(commandStr, tempDatabases); // Pass full command
            if (result.newDatabases) {
              tempDatabases = result.newDatabases;
              needsSave = !result.output.startsWith('Error:');
            }
            addHistoryEntry(result.output.startsWith('Error:') ? 'error' : 'output', result.output);
          } else if (args[0]?.toUpperCase() === 'TABLE' && args[1]) {
             result = handleCreateTable(commandStr, currentDatabase, tempDatabases);
             if (result.newDatabases) {
                tempDatabases = result.newDatabases;
                needsSave = !result.output.startsWith('Error:');
             }
             addHistoryEntry(result.output.startsWith('Error:') ? 'error' : 'output', result.output);
          } else {
            addHistoryEntry('error', `Error: Unknown CREATE command in '${commandStr}'. Try CREATE DATABASE <name> [WITH PASSWORD '<password>']; or CREATE TABLE <name> (...);`);
          }
          break;
        case 'SHOW':
          const showArg = args[0]?.replace(/;/g, '').toUpperCase();
          if (showArg === 'DATABASES') {
            addHistoryEntry('output', handleShowDatabases(tempDatabases)); 
          } else if (showArg === 'TABLES') {
             addHistoryEntry('output', handleShowTables(currentDatabase, tempDatabases));
          } else {
            addHistoryEntry('error', `Error: Unknown SHOW command in '${commandStr}'. Try SHOW DATABASES; or SHOW TABLES;`);
          }
          break;
        case 'USE':
          if (args[0]) {
            const dbName = args[0].replace(/;/g, '');
            result = handleUseDatabase(dbName, tempDatabases); 
            if (result.requiresPasswordInput && result.dbToAuth) {
              setAwaitingPasswordForDb(result.dbToAuth);
              addHistoryEntry('output', result.output);
              return; // Stop processing further commands on this line, wait for password
            } else if (result.newCurrentDb !== undefined && !(typeof result.output === 'string' && result.output.startsWith('Error:'))) {
              setCurrentDatabase(result.newCurrentDb); 
            }
            addHistoryEntry((typeof result.output === 'string' && result.output.startsWith('Error:')) ? 'error' : 'output', result.output);
          } else {
            addHistoryEntry('error', `Error: Missing database name for USE command in '${commandStr}'.`);
          }
          break;
        case 'DESCRIBE':
        case 'DESC':
          if (args[0]) {
            const tableName = args[0].replace(/;/g, '');
            addHistoryEntry('output', handleDescribeTable(tableName, currentDatabase, tempDatabases));
          } else {
            addHistoryEntry('error', `Error: Missing table name for DESCRIBE command in '${commandStr}'.`);
          }
          break;
        case 'INSERT':
          result = handleInsertData(commandStr, currentDatabase, tempDatabases);
          if (result.newDatabases) {
            tempDatabases = result.newDatabases;
            needsSave = !(typeof result.output === 'string' && result.output.startsWith('Error:'));
          }
          addHistoryEntry((typeof result.output === 'string' && result.output.startsWith('Error:')) ? 'error' : 'output', result.output);
          break;
        case 'SELECT':
          result = handleSelectData(commandStr, currentDatabase, tempDatabases);
          addHistoryEntry( (typeof result.output === 'string' && result.output.startsWith('Error:')) || (Array.isArray(result.output) && typeof result.output[0] === 'string' && result.output[0].startsWith('Error:')) ? 'error' : 'output', result.output);
          break;
        case 'DROP':
          if (args[0]?.toUpperCase() === 'TABLE' && args[1]) {
            const tableName = args[1].replace(/;/g, '');
            result = handleDropTable(tableName, currentDatabase, tempDatabases);
            if (result.newDatabases) {
              tempDatabases = result.newDatabases;
              needsSave = !result.output.startsWith('Error:');
            }
            addHistoryEntry(result.output.startsWith('Error:') ? 'error' : 'output', result.output);
          } else if (args[0]?.toUpperCase() === 'DATABASE' && args[1]) {
            const dbNameToDrop = args[1].replace(/;/g, '');
            result = handleDropDatabase(dbNameToDrop, currentDatabase, tempDatabases);
            
            if (result.requiresPasswordInputForDrop && result.dbToAuthForDrop) {
                setAwaitingPasswordForDropDb(result.dbToAuthForDrop);
                addHistoryEntry('output', result.output);
                // Important: if this line has multiple commands, and this one requires password,
                // we need to stop processing the rest of the commands on this line here.
                // The password input will be handled on the next submission.
                return; 
            }

            if (result.newDatabases) {
              tempDatabases = result.newDatabases;
              if (result.newCurrentDb !== undefined) { 
                setCurrentDatabase(result.newCurrentDb);
              }
              needsSave = !(typeof result.output === 'string' && result.output.startsWith('Error:'));
            }
            addHistoryEntry( (typeof result.output === 'string' && result.output.startsWith('Error:')) || (Array.isArray(result.output) && typeof result.output[0] === 'string' && result.output[0].startsWith('Error:')) ? 'error' : 'output', result.output);
          } else {
            addHistoryEntry('error', `Error: Unknown DROP command in '${commandStr}'. Try DROP TABLE <name>; or DROP DATABASE <name>;`);
          }
          break;
        case 'UPDATE':
          result = handleUpdateData(commandStr, currentDatabase, tempDatabases);
          if (result.newDatabases) {
            tempDatabases = result.newDatabases;
            needsSave = !result.output.startsWith('Error:');
          }
          addHistoryEntry(result.output.startsWith('Error:') ? 'error' : 'output', result.output);
          break;
        case 'DELETE':
           if (args[0]?.toUpperCase() === 'FROM' && args[1]) {
            result = handleDeleteData(commandStr, currentDatabase, tempDatabases);
            if (result.newDatabases) {
                tempDatabases = result.newDatabases;
                needsSave = !result.output.startsWith('Error:');
            }
            addHistoryEntry(result.output.startsWith('Error:') ? 'error' : 'output', result.output);
           } else {
             addHistoryEntry('error', `Error: Invalid DELETE syntax. Expected: DELETE FROM <table_name> ...;`);
           }
          break;
        case 'ALTER':
            if (args[0]?.toUpperCase() === 'TABLE' && args[2]?.toUpperCase() === 'ADD' && args[3]?.toUpperCase() === 'COLUMN') {
                result = handleAlterTableAddColumn(args, currentDatabase, tempDatabases);
                if (result.newDatabases) {
                    tempDatabases = result.newDatabases;
                    needsSave = !result.output.startsWith('Error:');
                }
                addHistoryEntry(result.output.startsWith('Error:') ? 'error' : 'output', result.output);
            } else {
                addHistoryEntry('error', `Error: Unsupported ALTER command. Try ALTER TABLE <name> ADD COLUMN <col_name> <col_type>;`);
            }
            break;
        case 'RENAME':
          if (args[0]?.toUpperCase() === 'TABLE' && args[1] && args[2]?.toUpperCase() === 'TO' && args[3]) {
            const oldTableName = args[1];
            const newTableName = args[3].replace(/;/g, '');
            result = handleRenameTable(oldTableName, newTableName, currentDatabase, tempDatabases);
            if (result.newDatabases) {
              tempDatabases = result.newDatabases;
              needsSave = !result.output.startsWith('Error:');
            }
            addHistoryEntry(result.output.startsWith('Error:') ? 'error' : 'output', result.output);
          } else {
            addHistoryEntry('error', `Error: Invalid RENAME syntax. Expected: RENAME TABLE <old_name> TO <new_name>;`);
          }
          break;
        case 'CLEAR':
          setHistory([]);
           addHistoryEntry('output', ["Terminal cleared."]);
           addHistoryEntry('output', initialWelcomeMessages);
          break;
        case 'EXIT':
          setHistory([]);
          setCurrentDatabase(null);
          setAwaitingPasswordForDb(null);
          setAwaitingPasswordForDropDb(null);
          addHistoryEntry('output', "Goodbye!");
          setTimeout(() => addHistoryEntry('output', initialWelcomeMessages), 50);
          break;
        case 'HELP':
          addHistoryEntry('output', [
            "Available Commands:",
            "  CREATE DATABASE <db_name> [WITH PASSWORD '<password>'];",
            "  SHOW DATABASES;",
            "  USE <db_name>; (If password protected, enter password on next line)",
            "  DROP DATABASE <db_name>; (If protected & not current DB, prompts for password)",
            "  CREATE TABLE <table_name> (col1_def, col2_def, ...);",
            "    Example: CREATE TABLE users (id INT, name VARCHAR(100));",
            "  SHOW TABLES;",
            "  DESCRIBE <table_name>; (or DESC <table_name>;)",
            "  ALTER TABLE <table_name> ADD COLUMN <col_name> <col_type_def>;",
            "    Example: ALTER TABLE users ADD COLUMN email VARCHAR(255);",
            "  RENAME TABLE <old_table_name> TO <new_table_name>;",
            "  DROP TABLE <table_name>;",
            "  INSERT INTO <table_name> [(col1, ...)] VALUES (val1, ...);",
            "  SELECT <columns | *> FROM <table_name> [WHERE cond] [ORDER BY col [ASC|DESC]] [LIMIT num];",
            "    Example: SELECT name, age FROM users WHERE city = 'New York' ORDER BY age DESC LIMIT 10;",
            "  UPDATE <table_name> SET col1 = val1, ... [WHERE condition];",
            "  DELETE FROM <table_name> [WHERE condition];",
            "  ASSIST \"<your_sql_question>\"; -- Get AI syntax help",
            "  CLEAR; -- Clear the terminal screen",
            "  EXIT; -- Clear screen, reset current database, and show goodbye message",
            "  HELP; -- Show this help message",
            "  -- <your_comment> -- Add a comment (ignored by SQL engine)",
            "Note: Multiple commands can be entered on one line, separated by semicolons.",
            "       Semicolons in string literals with multiple commands on one line may not parse correctly.",
            "Database data is saved on the server (simulated via JSON file).",
          ]);
          break;
        default:
          if (commandStr) {
             addHistoryEntry('error', `Error: Unknown command '${commandName}' in '${commandStr}'. Type HELP; for a list of commands.`);
          }
      }
      if (needsSave) {
        setDatabases(tempDatabases); 
        await saveDatabasesToServer(tempDatabases);
      }
    }
    if (JSON.stringify(databases) !== JSON.stringify(tempDatabases) && !awaitingPasswordForDb && !awaitingPasswordForDropDb) {
        setDatabases(tempDatabases); 
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isLoadingAssistant || isSavingData || isLoadingInitialData) return; 
    processCommand(inputValue);
    setInputValue('');
  };

  const getPromptText = () => {
    if (awaitingPasswordForDropDb) {
      return `Password to drop ${awaitingPasswordForDropDb}:`;
    }
    if (awaitingPasswordForDb) {
      return `Password for ${awaitingPasswordForDb}:`;
    }
    return currentDatabase ? `${currentDatabase}$` : '@sql-cliq $';
  };

  if (!isMounted || isLoadingInitialData) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-card p-4 overflow-hidden rounded-lg border border-border shadow-md">
        <Terminal className="h-16 w-16 text-accent animate-pulse" />
        <p className="text-foreground mt-4">
          {isLoadingInitialData ? "Loading database from server..." : "Initializing SQL Cliq..."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card text-foreground font-mono overflow-hidden rounded-lg border border-border shadow-md" onClick={() => inputRef.current?.focus()}>
      <header className="p-3 md:p-4 flex items-center gap-2 flex-shrink-0 bg-background border-b border-border sticky top-0 z-10">
        <Terminal className="h-6 w-6 text-accent" />
        <h1 className="text-xl font-semibold text-foreground">SQL Cliq</h1>
        {isSavingData && (
             <div className="flex items-center text-xs text-muted-foreground">
                <svg className="animate-spin -ml-1 mr-1 h-3 w-3 " xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Saving...
            </div>
        )}
      </header>
      
      <ScrollArea className="flex-grow w-full bg-input/30 shadow-inner min-h-0 border border-border rounded-md m-2 md:m-4" ref={scrollAreaRef}>
        <div className="text-sm md:text-base p-3 md:p-4">
          {history.map(entry => (
            <div key={entry.id} className={`mb-1.5 ${
                entry.type === 'error' ? 'text-destructive' 
                : entry.type === 'assist-output' ? 'text-accent' 
                : entry.type === 'comment' ? 'text-muted-foreground/80'
                : 'text-foreground/90' // Covers 'output' and 'assist-input'
            }`}>
              {entry.type === 'input' || entry.type === 'comment' ? (
                <div className="flex">
                  <span className="text-accent mr-1">{entry.prompt}</span>
                  <pre className="whitespace-pre-wrap break-words">{entry.content}</pre>
                </div>
              ) : entry.type === 'output' || entry.type === 'error' ? (
                Array.isArray(entry.content) ? 
                  entry.content.map((line, idx) => <pre key={idx} className="whitespace-pre-wrap break-words">{`»›› ${line}`}</pre>) :
                  <pre className="whitespace-pre-wrap break-words">{`»›› ${entry.content}`}</pre>
              ) : (entry.type === 'assist-input' || entry.type === 'assist-output') ? (
                Array.isArray(entry.content) ? 
                  entry.content.map((line, idx) => <pre key={idx} className="whitespace-pre-wrap break-words">{line}</pre>) :
                  <pre className="whitespace-pre-wrap break-words">{entry.content}</pre>
              ) : null}
            </div>
          ))}
           {isLoadingAssistant && (
            <div className="flex items-center text-accent">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>AI Thinking...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      <form onSubmit={handleSubmit} className="p-3 md:p-4 flex items-center gap-2 flex-shrink-0 bg-background border-t border-border">
        <span className="text-accent text-sm md:text-base">
          {getPromptText()}
        </span>
        <Input
          ref={inputRef}
          type={awaitingPasswordForDb || awaitingPasswordForDropDb ? "password" : "text"}
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          className="flex-grow bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto text-sm md:text-base text-foreground placeholder:text-muted-foreground"
          placeholder={
            awaitingPasswordForDropDb 
              ? " Enter password to confirm drop..." 
              : awaitingPasswordForDb 
                ? " Enter password..." 
                : " Type SQL command or HELP; ..."
          }
          spellCheck="false"
          autoComplete="off"
          disabled={isLoadingAssistant || isSavingData || isLoadingInitialData}
        />
        <span className="blinking-cursor text-accent text-sm md:text-base">|</span>
        <Button type="submit" size="sm" variant="ghost" className="text-accent hover:bg-accent/10 hover:text-accent" disabled={isLoadingAssistant || isSavingData || isLoadingInitialData || !inputValue.trim()}>
          Enter
        </Button>
      </form>
    </div>
  );
}

