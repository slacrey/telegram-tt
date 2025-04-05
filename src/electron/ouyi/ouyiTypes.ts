// Type definitions for OuYi trading data

/**
 * Represents a trade item from OuYi
 */
export interface TradeItem {
  side: string;
  payment: string;
  company: string;
  price: number;
}

/**
 * Payment methods mapping
 */
export const PAYMENT_METHODS = {
  all: 'All',
  aliPay: 'AliPay',
  wxPay: 'WeChat',
  bank: 'Bank',
};

/**
 * Side mapping for requests
 */
export const SIDE_MAP: Record<string, string> = {
  buy: 'sell',
  sell: 'buy',
}; 
