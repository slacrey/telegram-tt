import dotenv from 'dotenv';

import { setupOuYiStorageIpcHandlers } from './ouyi/ouyiStorage';
import { startOuYiTask, stopOuYiTask } from './ouyi/ouyiTask';

// Load environment variables
dotenv.config();

// Export OuYi task functions
export { startOuYiTask, stopOuYiTask };

// Setup IPC handlers for all scheduled tasks
export function setupTaskIpcHandlers() {
  // Setup OuYi IPC handlers
  setupOuYiStorageIpcHandlers();
  // Other task IPC handlers would be set up here
}
