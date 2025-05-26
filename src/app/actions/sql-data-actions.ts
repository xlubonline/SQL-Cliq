'use server';

import type { DatabasesStructure } from '@/components/sql-cli/types';
import fs from 'fs/promises';
import path from 'path';

const DATA_FILE_PATH = path.join(process.cwd(), 'src', 'data', 'sql-cliq-databases.json');
const DATA_DIR_PATH = path.join(process.cwd(), 'src', 'data');

async function ensureDataDirectoryExists() {
  try {
    await fs.access(DATA_DIR_PATH);
  } catch (error) {
    // Directory does not exist, create it
    await fs.mkdir(DATA_DIR_PATH, { recursive: true });
  }
}

export async function loadDatabasesAction(): Promise<DatabasesStructure> {
  await ensureDataDirectoryExists();
  try {
    await fs.access(DATA_FILE_PATH);
    const fileContent = await fs.readFile(DATA_FILE_PATH, 'utf-8');
    if (!fileContent.trim()) {
      return {}; // File is empty, return empty structure
    }
    return JSON.parse(fileContent) as DatabasesStructure;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // File does not exist, return empty structure and it will be created on first save
      return {};
    }
    console.error('Failed to load databases:', error);
    // In case of other errors (e.g., corrupted JSON), return empty and log
    // Or throw an error to be handled by the client
    throw new Error('Could not load database data. File might be corrupted.');
  }
}

export async function saveDatabasesAction(databases: DatabasesStructure): Promise<void> {
  await ensureDataDirectoryExists();
  try {
    const dataString = JSON.stringify(databases, null, 2);
    await fs.writeFile(DATA_FILE_PATH, dataString, 'utf-8');
  } catch (error) {
    console.error('Failed to save databases:', error);
    throw new Error('Could not save database data to server.');
  }
}
