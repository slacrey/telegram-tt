import dotenv from 'dotenv';
import {ipcMain} from 'electron';
import {OrderRequest, UpdateOrderRequest} from "./orderTypes";
import axios from "axios";

// Load environment variables
dotenv.config();

// Data storage directory configuration
const REQUEST_URL = process.env.API_PATH || 'http://154.23.176.5:5000';


export async function findOrderValidate(request: OrderRequest) {
  try {
    const url = `${REQUEST_URL}/find_order_validate`;

    const response = await axios.post(url, request, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    return response.data;
  } catch (error) {
    // Using console.error for error logging
    // eslint-disable-next-line no-console
    console.error('Error validating order:', error);
    return undefined;
  }
}

export async function updateOrderById(request: UpdateOrderRequest) {
  try {
    const url = `${REQUEST_URL}/update_order_by_id`;

    const response = await axios.post(url, request, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    return response.data;
  } catch (error) {
    // Using console.error for error logging
    // eslint-disable-next-line no-console
    console.error('Error validating order:', error);
    return undefined;
  }
}

/**
 * Sets up IPC handlers for the renderer process to access Api
 */
export function setupOrderApiIpcHandlers() {

  ipcMain.handle('order:findOrderValidate', async (event, request) => {
    return await findOrderValidate(request);
  });

  ipcMain.handle('order:updateOrderById', async (event, request) => {
    return await updateOrderById(request);
  });

}
