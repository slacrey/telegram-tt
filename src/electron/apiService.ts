import express from 'express';
import cors from 'cors';
import { BrowserWindow, ipcMain } from 'electron';
import dotenv from 'dotenv';
import type { Request, Response, NextFunction } from 'express';
import { ElectronEvent } from '../types/electron';

// Load environment variables
dotenv.config();

// API service configuration
const PORT = process.env.API_PORT || 9000;
const API_TOKEN = process.env.API_TOKEN || 'secure-api-token-for-telegram-client';

// Authentication middleware
const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ code: 401, message: 'Unauthorized: Missing or invalid token' });
    return;
  }
  
  const token = authHeader.split(' ')[1];
  
  if (token !== API_TOKEN) {
    res.status(401).json({ code: 401, message: 'Unauthorized: Invalid token' });
    return;
  }
  
  next();
};

// Request timeout middleware - 5s timeout as specified
const timeoutMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const timeout = 5000; // 5 seconds
  
  const timeoutId = setTimeout(() => {
    if (!res.headersSent) {
      res.status(504).json({ code: 504, message: 'Request timed out' });
    }
  }, timeout);
  
  // Clear the timeout when the response is sent
  res.on('finish', () => {
    clearTimeout(timeoutId);
  });
  
  next();
};

// Error handling middleware
const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction): void => {
  console.error('API Error:', err);
  
  if (!res.headersSent) {
    res.status(500).json({ code: 500, message: 'Internal server error' });
  }
  
  next(err);
};

// Create Express app
const app = express();

// Authentication state (to be updated by main process)
let isLoggedIn = false;

// Setup middleware
app.use(cors());
app.use(express.json());
app.use(timeoutMiddleware);

// Define API routes
app.post('/sendMessage', authMiddleware, (req: Request, res: Response) => {
  if (!isLoggedIn) {
    console.log('API: Rejecting message - User not logged in');
    return res.status(400).json({ code: 400, message: '飞机号未登录' });
  }
  
  const { chatId, content } = req.body;
  
  if (!chatId || !content) {
    console.log('API: Rejecting message - Missing parameters');
    return res.status(400).json({ code: 400, message: 'Missing required parameters' });
  }

  // chatId 可以是数字 ID 或 @username 格式
  console.log(`API: Sending message to ${chatId}: ${content.substring(0, 30)}${content.length > 30 ? '...' : ''}`);
  
  // Forward the request to the renderer process to use telegram APIs
  ipcMain.once('sendMessage:response', (_event, response) => {
    if (response.success) {
      console.log('API: Message sent successfully');
      res.status(200).json({ code: 200, message: '发送成功' });
    } else {
      console.error('API: Message send failed:', response.error);
      res.status(500).json({ code: 500, message: response.error || '内部错误' });
    }
  });
  
  // Send request to renderer process
  app.emit('sendMessage:request', { chatId, content });
});

// Default error handler
app.use(errorHandler);

// Export functions to start/stop the server and update authentication state
export const startApiService = (): void => {
  const server = app.listen(PORT, () => {
    console.log(`Telegram API server is running on port ${PORT}`);
  });

  return server;
};

export const updateAuthState = (loggedIn: boolean): void => {
  isLoggedIn = loggedIn;
  console.log(`API: Authentication state updated: ${loggedIn ? 'Logged in' : 'Logged out'}`);
};

// Expose IPC event listeners for main<->renderer communication
export const setupApiServiceIpcHandlers = (mainWindow: BrowserWindow): void => {
  console.log('API: Setting up IPC handlers');

  // Listen for authentication state updates from renderer
  ipcMain.on('apiService:updateAuthState', (_event, loggedIn) => {
    console.log(`API: Received auth state update: ${loggedIn ? 'Logged in' : 'Logged out'}`);
    updateAuthState(loggedIn);
  });
  
  // When renderer process confirms message sent
  ipcMain.on('apiService:sendMessageResult', (event, result) => {
    console.log(`API: Received message result: ${result.success ? 'Success' : 'Failed'}`);
    ipcMain.emit('sendMessage:response', event, result);
  });
  
  // Forward send message requests to renderer
  app.on('sendMessage:request', (data) => {
    console.log('API: Forwarding message request to renderer');
    mainWindow.webContents.send('apiService:sendMessage', data);
  });
}; 