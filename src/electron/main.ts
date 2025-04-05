import 'v8-compile-cache';

import { app, nativeImage } from 'electron';
import contextMenu from 'electron-context-menu';
import path from 'path';

import { initDeeplink } from './deeplink';
import { setupApiServiceIpcHandlers, startApiService } from './apiService';
import { IS_MAC_OS, IS_PRODUCTION, IS_WINDOWS } from './utils';
import { createWindow, setupCloseHandlers, setupElectronActionHandlers } from './window';

// Initialize deeplink
initDeeplink();

// Setup context menu
contextMenu({
  showLearnSpelling: false,
  showLookUpSelection: false,
  showSearchWithGoogle: false,
  showCopyImage: false,
  showSelectAll: true,
  showInspectElement: !IS_PRODUCTION,
});

// When Electron is ready
app.on('ready', () => {
  // Set dock icon for macOS
  if (IS_MAC_OS) {
    app.dock.setIcon(nativeImage.createFromPath(path.resolve(__dirname, '../public/icon-electron-macos.png')));
  }

  // Set app ID for Windows
  if (IS_WINDOWS) {
    app.setAppUserModelId(app.getName());
  }

  // Create the main window
  const mainWindow = createWindow();

  // Setup Electron action handlers
  setupElectronActionHandlers();
  setupCloseHandlers();

  // Setup API service and IPC handlers for communication between main and renderer processes
  setupApiServiceIpcHandlers(mainWindow);
  
  // Start the API service on the configured port
  startApiService();
});
