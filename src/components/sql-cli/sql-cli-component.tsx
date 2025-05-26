
'use client';

import { getSqlCommand } from '@/ai/flows/sql-syntax-assistance';
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
  handleCreateTable,
  handleShowTables,
  handleDescribeTable,
  handleInsertData,
  handleSelectData
} from './utils';

const SQL_CLIQ_DATABASES_KEY = 'sqlCliqDatabases';
const SQL_CLIQ_CURRENT_DB_KEY = 'sqlCliqCurrentDb';
const SQL_CLIQ_HISTORY_KEY = 'sqlCliqHistory';


export function SqlCliComponent() {
  const [inputValue, setInputValue] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [databases, setDatabases] = useState<DatabasesStructure>({});
  const [currentDatabase, setCurrentDatabase] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [isLoadingAssistant, setIsLoadingAssistant] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Load state from localStorage on mount
  useEffect(() => {
    setIsMounted(true);
    try {
      const savedDatabases = localStorage.getItem(SQL_CLIQ_DATABASES_KEY);
      if (savedDatabases) setDatabases(JSON.parse(savedDatabases));

      const savedCurrentDb = localStorage.getItem(SQL_CLIQ_CURRENT_DB_KEY);
      if (savedCurrentDb) setCurrentDatabase(savedCurrentDb);
      
      const savedHistory = localStorage.getItem(SQL_CLIQ_HISTORY_KEY);
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory));
      } else {
         // Initial welcome message if no history
        addHistoryEntry('output', [
          "Welcome to SQL Cliq!",
          "Type 'ASSIST \"your question\"' for AI help (e.g., ASSIST \"how to create a table\").",
          "Type 'HELP;' for a list of basic commands.",
        ]);
      }

    } catch (error) {
      console.error("Failed to load state from localStorage:", error);
      toast({ title: "Error", description: "Could not load saved session data.", variant: "destructive" });
       addHistoryEntry('output', [
          "Welcome to SQL Cliq!",
          "Type 'ASSIST \"your question\"' for AI help (e.g., ASSIST \"how to create a table\").",
          "Type 'HELP;' for a list of basic commands.",
        ]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]); // addHistoryEntry is not stable, so not including it here

  // Save state to localStorage
  useEffect(() => {
    if (isMounted) {
      localStorage.setItem(SQL_CLIQ_DATABASES_KEY, JSON.stringify(databases));
    }
  }, [databases, isMounted]);

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


  // Scroll to bottom and focus input
  useEffect(() => {
    if (scrollAreaRef.current) {
      const viewport = scrollAreaRef.current.querySelector('div[data-radix-scroll-area-viewport]');
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }
    inputRef.current?.focus();
  }, [history]);


  const addHistoryEntry = useCallback((type: HistoryEntry['type'], content: string | string[], currentPrompt?: string) => {
    setHistory(prev => [...prev, { id: Date.now().toString() + Math.random(), type, content, prompt: currentPrompt }]);
  }, []);

  const processCommand = async (fullInputLine: string) => {
    const trimmedFullInputLine = fullInputLine.trim();
    if (!trimmedFullInputLine) return;

    const currentPrompt = `${currentDatabase ? `${currentDatabase}>` : 'sql-cliq>'}`;
    
    if (trimmedFullInputLine.startsWith('--')) {
      addHistoryEntry('comment', trimmedFullInputLine, currentPrompt);
      return;
    }
    
    addHistoryEntry('input', trimmedFullInputLine, currentPrompt);

    const individualCommandStrings = trimmedFullInputLine
      .split(';')
      .map(cmd => cmd.trim())
      .filter(cmd => cmd.length > 0);

    for (const commandStr of individualCommandStrings) {
      if (isLoadingAssistant) continue; // Skip if AI is already working from a previous command in the batch

      const { commandName, args } = parseCommand(commandStr);
      let result: { newDatabases?: DatabasesStructure; newCurrentDb?: string | null; output: string | string[] };

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
          continue; // Move to next command in batch if any
        } else {
          addHistoryEntry('error', "Error: Invalid ASSIST syntax. Expected: ASSIST \"your question about SQL\".");
          continue; 
        }
      }
      
      switch (commandName) {
        case 'CREATE':
          if (args[0]?.toUpperCase() === 'DATABASE' && args[1]) {
            const dbName = args[1].replace(/;/g, '');
            result = handleCreateDatabase(dbName, databases);
            if (result.newDatabases) setDatabases(result.newDatabases);
            addHistoryEntry(result.output.startsWith('Error:') ? 'error' : 'output', result.output);
          } else if (args[0]?.toUpperCase() === 'TABLE' && args[1]) {
             result = handleCreateTable(commandStr, currentDatabase, databases);
             if (result.newDatabases) setDatabases(result.newDatabases);
             addHistoryEntry(result.output.startsWith('Error:') ? 'error' : 'output', result.output);
          } else {
            addHistoryEntry('error', `Error: Unknown CREATE command in '${commandStr}'. Try CREATE DATABASE <name>; or CREATE TABLE <name> (...);`);
          }
          break;
        case 'SHOW':
          const showArg = args[0]?.replace(/;/g, '').toUpperCase();
          if (showArg === 'DATABASES') {
            addHistoryEntry('output', handleShowDatabases(databases));
          } else if (showArg === 'TABLES') {
             addHistoryEntry('output', handleShowTables(currentDatabase, databases));
          } else {
            addHistoryEntry('error', `Error: Unknown SHOW command in '${commandStr}'. Try SHOW DATABASES; or SHOW TABLES;`);
          }
          break;
        case 'USE':
          if (args[0]) {
            const dbName = args[0].replace(/;/g, '');
            result = handleUseDatabase(dbName, databases);
            if (result.newCurrentDb !== undefined) setCurrentDatabase(result.newCurrentDb); // Allow setting to null
            addHistoryEntry(result.output.startsWith('Error:') ? 'error' : 'output', result.output);
          } else {
            addHistoryEntry('error', `Error: Missing database name for USE command in '${commandStr}'.`);
          }
          break;
        case 'DESCRIBE':
        case 'DESC':
          if (args[0]) {
            const tableName = args[0].replace(/;/g, '');
            addHistoryEntry('output', handleDescribeTable(tableName, currentDatabase, databases));
          } else {
            addHistoryEntry('error', `Error: Missing table name for DESCRIBE command in '${commandStr}'.`);
          }
          break;
        case 'INSERT':
          result = handleInsertData(commandStr, currentDatabase, databases);
          addHistoryEntry(result.output.startsWith('Error:') ? 'error' : 'output', result.output);
          break;
        case 'SELECT':
          result = handleSelectData(commandStr, currentDatabase, databases);
          addHistoryEntry(result.output.startsWith('Error:') ? 'error' : 'output', result.output);
          break;
        case 'CLEAR':
          setHistory([]);
          addHistoryEntry('output', "Terminal cleared.");
          break;
        case 'HELP':
          addHistoryEntry('output', [
            "Available Commands:",
            "  CREATE DATABASE <db_name>;",
            "  SHOW DATABASES;",
            "  USE <db_name>;",
            "  CREATE TABLE <table_name> (col1_def, col2_def, ...);",
            "    Example: CREATE TABLE users (id INT, name VARCHAR(100));",
            "  SHOW TABLES;",
            "  DESCRIBE <table_name>; (or DESC <table_name>;)",
            "  INSERT INTO <table_name> VALUES (...);",
            "  SELECT <columns> FROM <table_name>;",
            "  ASSIST \"<your_sql_question>\"; -- Get AI syntax help",
            "  CLEAR; -- Clear the terminal",
            "  HELP; -- Show this help message",
            "  -- <your_comment> -- Add a comment (ignored by SQL engine)",
            "Note: Multiple commands can be entered on one line, separated by semicolons.",
          ]);
          break;
        default:
          if (commandStr) { // Check if commandStr is not empty (e.g. from excessive semicolons)
             addHistoryEntry('error', `Error: Unknown command '${commandName}' in '${commandStr}'. Type HELP; for a list of commands.`);
          }
      }
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isLoadingAssistant) return; 
    processCommand(inputValue);
    setInputValue('');
  };

  if (!isMounted) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-background p-4">
        <Terminal className="h-16 w-16 text-accent animate-pulse" />
        <p className="text-foreground mt-4">Loading SQL Cliq...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground p-2 md:p-4 font-mono" onClick={() => inputRef.current?.focus()}>
      <header className="mb-2 md:mb-4 flex items-center gap-2">
        <Terminal className="h-6 w-6 text-accent" />
        <h1 className="text-xl font-semibold text-foreground">SQL Cliq</h1>
      </header>
      
      <ScrollArea className="flex-grow w-full bg-input/30 rounded-md p-3 md:p-4 shadow-inner" ref={scrollAreaRef}>
        <div className="text-sm md:text-base">
          {history.map(entry => (
            <div key={entry.id} className={`mb-1.5 ${
                entry.type === 'error' ? 'text-destructive' 
                : entry.type === 'assist-output' ? 'text-accent' 
                : entry.type === 'comment' ? 'text-muted-foreground/80'
                : 'text-foreground/90'
            }`}>
              {(entry.type === 'input' || entry.type === 'comment') && (
                <div className="flex">
                  <span className="text-accent mr-1">{entry.prompt}</span>
                  <pre className="whitespace-pre-wrap break-words">{entry.content}</pre>
                </div>
              )}
              {(entry.type === 'output' || entry.type === 'error' || entry.type === 'assist-input' || entry.type === 'assist-output') && 
               entry.type !== 'comment' &&
              (
                Array.isArray(entry.content) ? 
                  entry.content.map((line, idx) => <pre key={idx} className="whitespace-pre-wrap break-words">{line}</pre>) :
                  <pre className="whitespace-pre-wrap break-words">{entry.content}</pre>              
              )}
            </div>
          ))}
           {isLoadingAssistant && (
            <div className="flex items-center text-accent">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Thinking...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      <form onSubmit={handleSubmit} className="mt-2 md:mt-4 flex items-center gap-2">
        <span className="text-accent text-sm md:text-base">
          {currentDatabase ? `${currentDatabase}>` : 'sql-cliq>'}
        </span>
        <Input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          className="flex-grow bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto text-sm md:text-base text-foreground placeholder:text-muted-foreground"
          placeholder="Type SQL command or HELP; ..."
          spellCheck="false"
          autoComplete="off"
          disabled={isLoadingAssistant}
        />
        <span className="blinking-cursor text-accent text-sm md:text-base">|</span>
        <Button type="submit" size="sm" variant="ghost" className="text-accent hover:bg-accent/10 hover:text-accent" disabled={isLoadingAssistant}>
          Enter
        </Button>
      </form>
    </div>
  );
}
