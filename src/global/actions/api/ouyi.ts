import { getGlobal } from '../../index';
import { ActionReturnType } from '../../types';
import { addActionHandler } from '../../index';

// Define the TradeItem interface
interface TradeItem {
  side: string;
  payment: string;
  company: string;
  price: number;
}

// Add an action to get all OuYi trade data
addActionHandler('getOuYiTradeData', async (global): Promise<ActionReturnType> => {
  try {
    // Use the ipcRenderer to call the main process
    const data = await window.electron.ipcRenderer.invoke('ouyi:getAllTradeData');
    
    return {
      ...global,
      ouyi: {
        ...global.ouyi,
        tradeData: data,
        lastUpdated: Date.now(),
      },
    };
  } catch (error) {
    console.error('Error getting OuYi trade data:', error);
    return global;
  }
});

// Add an action to get specific OuYi trade data
addActionHandler('getOuYiTradeDataBySideAndPayment', async (global, actions, payload): Promise<ActionReturnType> => {
  try {
    const { side, payment } = payload;
    
    // Use the ipcRenderer to call the main process
    const data = await window.electron.ipcRenderer.invoke('ouyi:getTradeData', side, payment);
    
    // Construct update path
    const tradeKey = `${side}:${payment}`;
    
    return {
      ...global,
      ouyi: {
        ...global.ouyi,
        tradeData: {
          ...global.ouyi?.tradeData,
          [tradeKey]: data,
        },
        lastUpdated: Date.now(),
      },
    };
  } catch (error) {
    console.error('Error getting OuYi trade data:', error);
    return global;
  }
});

// Helper function to get OuYi trade data
export function getOuYiTradeData(): Record<string, TradeItem[]> {
  const global = getGlobal();
  return global.ouyi?.tradeData || {};
}

// Helper function to get OuYi trade data by side and payment
export function getOuYiTradeDataBySideAndPayment(side: string, payment: string): TradeItem[] {
  const global = getGlobal();
  const tradeKey = `${side}:${payment}`;
  return global.ouyi?.tradeData?.[tradeKey] || [];
}

// Helper function to get the latest price from OuYi data
export function getLatestOuYiPrice(side: string, payment = 'all'): number | null {
  const tradeData = getOuYiTradeDataBySideAndPayment(side, payment);
  
  if (tradeData.length > 0) {
    return tradeData[0].price;
  }
  
  return null;
} 