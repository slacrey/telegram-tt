import axios from 'axios';
import dotenv from 'dotenv';
import { PAYMENT_METHODS, SIDE_MAP } from './ouyiTypes';
import type { TradeItem } from './ouyiTypes';
import { saveTradeInfo } from './ouyiStorage';

// Load environment variables
dotenv.config();

// Environment variables for scheduled tasks
const TASK_OUYI_ENABLED = process.env.TASK_OUYI_ENABLED === 'true';
const TASK_OUYI_INTERVAL = Number(process.env.TASK_OUYI_INTERVAL || '300000'); // Default: 5 minutes
const TASK_OUYI_NAME = process.env.TASK_OUYI_NAME || 'Fetch OuYi Trading Data';

// Task intervals storage
const taskIntervals: Record<string, NodeJS.Timeout> = {};

/**
 * Fetches trade info from OuYi API
 * @param side The trading side
 * @param payment The payment method
 * @returns API response data
 */
async function getTradeInfo(side: string, payment: string) {
  try {
    const baseUrl = 'https://www.okx.com/v3/c2c/tradingOrders/books?quoteCurrency=CNY&baseCurrency=USDT';

    // Add payment method if not 'all'
    let url = baseUrl;
    if (payment !== 'all') {
      url = `${url}&paymentMethod=${payment}`;
    }

    // Add side and timestamp
    const timestamp = Date.now();
    url = `${url}&side=${side}&t=${timestamp}`;

    // Make request with proper headers to avoid CORS issues
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.okx.com/',
        Origin: 'https://www.okx.com',
      },
    });

    return response.data;
  } catch (error) {
    // Using console.error for error logging
    console.error(`Error fetching OuYi data for ${side}/${payment}:`, error);
    return undefined;
  }
}

/**
 * Converts trade info API response to save format
 * @param requestSide The request side
 * @param side The trade side
 * @param tradeInfo The trade info from API
 * @param limit The maximum number of items to include
 * @returns List of trade items
 */
function convertTradeInfoToSave(requestSide: string, side: string, tradeInfo: any, limit = 10): TradeItem[] {
  if (!tradeInfo || !tradeInfo.data || !tradeInfo.data[requestSide]) {
    return [];
  }

  const tradeList: TradeItem[] = [];
  let count = 0;

  for (const item of tradeInfo.data[requestSide]) {
    if (count >= limit) break;

    const paymentStr = item.paymentMethods ? item.paymentMethods.join(',') : '';

    tradeList.push({
      side,
      payment: paymentStr,
      company: item.nickName || '',
      price: parseFloat(item.price) || 0,
    });

    count++;
  }

  return tradeList;
}

/**
 * Processes trade data for a specific direction and payment method
 * @param side The trading side
 * @param payment The payment method
 */
async function processTradeDirection(side: string, payment: string) {
  try {
    if (!(side in SIDE_MAP)) {
      // Using console.error for error logging
      console.error(`Invalid side: ${side}`);
      return;
    }

    const requestSide = SIDE_MAP[side];
    const tradeInfo = await getTradeInfo(requestSide, payment);

    if (!tradeInfo) return;

    const tradeList = convertTradeInfoToSave(requestSide, side, tradeInfo);
    saveTradeInfo(side, payment, tradeList);
  } catch (error) {
    // Using console.error for error logging
    console.error(`Error processing ${side}/${payment}:`, error);
  }
}

/**
 * Runs the OuYi data collection task
 */
async function runOuYiTask() {
  // Using console.log for operational logging
  console.log(`Running OuYi task: ${TASK_OUYI_NAME}`);

  for (const [paymentKey] of Object.entries(PAYMENT_METHODS)) {
    // Process buy direction (which means fetching sell orders)
    await processTradeDirection('buy', paymentKey);

    // Process sell direction (which means fetching buy orders)
    await processTradeDirection('sell', paymentKey);
  }

  // Using console.log for operational logging
  console.log('OuYi task completed');
}

/**
 * Starts the OuYi scheduled task
 */
export function startOuYiTask() {
  if (!TASK_OUYI_ENABLED) {
    // Using console.log for operational logging
    console.log('OuYi task is disabled');
    return;
  }

  // Using console.log for operational logging
  console.log(`Starting OuYi task with interval: ${TASK_OUYI_INTERVAL}ms`);

  // Run immediately
  runOuYiTask();

  // Schedule periodic execution
  const intervalId = setInterval(runOuYiTask, TASK_OUYI_INTERVAL);
  taskIntervals.ouyi = intervalId;
}

/**
 * Stops the OuYi scheduled task
 */
export function stopOuYiTask() {
  if (taskIntervals.ouyi) {
    clearInterval(taskIntervals.ouyi);
    delete taskIntervals.ouyi;
    // Using console.log for operational logging
    console.log('OuYi task stopped');
  }
} 
