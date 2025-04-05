import dotenv from 'dotenv';
import { app, ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';

import type { TradeItem } from './ouyiTypes';

// Load environment variables
dotenv.config();

// Data storage directory configuration
const TASK_OUYI_STORE_PATH = process.env.TASK_OUYI_STORE_PATH || 'data';
const DATA_DIR = path.join(app.getAppPath(), TASK_OUYI_STORE_PATH);

/**
 * Ensures the data directory exists
 */
export function ensureDataDirExists() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * Saves trade information to local storage
 * @param side The trading side
 * @param payment The payment method
 * @param tradeList List of trade items
 */
export function saveTradeInfo(side: string, payment: string, tradeList: TradeItem[]) {
  ensureDataDirExists();

  const tradeKey = `${side}:${payment}`;
  const filePath = path.join(DATA_DIR, `ouyi_${tradeKey.replace(':', '_')}.json`);

  fs.writeFileSync(filePath, JSON.stringify(tradeList), 'utf8');
  // Using console.log for operational logging
  console.log(`Saved OuYi trade data for ${side}/${payment} to ${filePath}`);
}

/**
 * Gets all OuYi trade data from local storage
 * @returns Record of trade data by key
 */
export function getAllTradeData(): Record<string, TradeItem[]> {
  try {
    ensureDataDirExists();

    const result: Record<string, TradeItem[]> = {};

    // Read all OuYi data files
    const files = fs.readdirSync(DATA_DIR);
    for (const file of files) {
      if (file.startsWith('ouyi_') && file.endsWith('.json')) {
        const filePath = path.join(DATA_DIR, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const key = file.replace('ouyi_', '').replace('.json', '').replace('_', ':');

        try {
          result[key] = JSON.parse(content);
        } catch (e) {
          // Using console.error for error logging
          console.error(`Error parsing JSON from ${file}:`, e);
        }
      }
    }

    return result;
  } catch (error) {
    // Using console.error for error logging
    console.error('Error getting OuYi trade data:', error);
    return {};
  }
}

/**
 * Gets specific OuYi trade data from local storage
 * @param side The trading side
 * @param payment The payment method
 * @returns List of trade items
 */
export function getTradeData(side: string, payment: string): TradeItem[] {
  try {
    const tradeKey = `${side}:${payment}`;
    const filePath = path.join(DATA_DIR, `ouyi_${tradeKey.replace(':', '_')}.json`);

    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    }

    return [];
  } catch (error) {
    // Using console.error for error logging
    console.error(`Error getting OuYi trade data for ${side}/${payment}:`, error);
    return [];
  }
}

/**
 * Sets up IPC handlers for the renderer process to access OuYi trade data
 */
export function setupOuYiStorageIpcHandlers() {
  // Handler to get all OuYi trade data
  ipcMain.handle('ouyi:getAllTradeData', () => {
    return getAllTradeData();
  });

  // Handler to get specific OuYi trade data
  ipcMain.handle('ouyi:getTradeData', (event, side, payment) => {
    return getTradeData(side, payment);
  });
}
