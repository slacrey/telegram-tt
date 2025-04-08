// Type definitions for OuYi trading data

import {Api} from "../../lib/gramjs";
import int = Api.int;

/**
 * Represents a Response from order
 */
export interface OrderResponse {
  code: int;
  message: string;
  data: BotMessage;
}

export interface BotMessage {
  id: int;
  agent_id: int;
  bot_name: string;
}

export interface OrderRequest {
  group_id: int;
  bot_name: string;
  order_no: string;
  from_username: string;
  from_message_id: int;
}

export interface UpdateOrderRequest {
  order_message_id: int;
  from_chat_id: int;
  from_message_id: int;
  to_chat_id: int;
  to_message_id: int;
}
