/* eslint-disable max-len */
import { callApi } from '../../../api/gramjs';
import type { ApiMessage } from '../../../api/types';
import type { selectChat } from '../../selectors';
import { selectChatMessage, selectUser } from '../../selectors';
import {
  loadSourceUserConfig,
  loadTargetUserConfig,
  saveSourceUserConfig,
  saveTargetUserConfig,
} from '../../../config/forwardConfig';
import { getMessageReplyInfo } from '../../helpers/replies';

// Auto-reply handlers for different message patterns
type MessagePattern = {
  match: (
    global: any,
    message: ApiMessage,
    chat: NonNullable<ReturnType<typeof selectChat>>
  ) => Promise<boolean> | boolean;
  reply: (
    global: any,
    message: ApiMessage,
    chat: NonNullable<ReturnType<typeof selectChat>>
  ) => Promise<string | undefined>;
};

// Function to extract text content from any message type
function extractMessageTextContent(message: ApiMessage): string | undefined {
  const {
    text, photo, video, audio, voice, document,
  } = message.content;

  // Get raw text content first
  let rawText = '';

  // First try to get text directly from message content
  if (text?.text) {
    rawText = text.text;
  } else if (photo || video || audio || voice || document) {
    // Caption might be in the text field even for media messages
    rawText = text?.text || '';
  }

  if (!rawText) {
    return undefined;
  }

  // Remove @mentions from the text (matches @username format)
  // This regex matches @ followed by username characters until a space or end of text
  const cleanedText = rawText.replace(/@[\w_]+\s?/g, '').trim();

  return cleanedText || rawText; // If cleaning removed all content, return original
}

// Rate limiting data structure to prevent excessive auto-replies
// Key: chatId_senderId, Value: last reply timestamp
const lastReplySent = new Map<string, number>();
// Cooldown period in milliseconds (5 seconds)
const REPLY_COOLDOWN = 5 * 1000;

// Auto-reply patterns system
const PRIVATE_AUTO_REPLY_PATTERNS: MessagePattern[] = [
  // Pattern 1: Private chat with "help" keyword in any message type
  {
    match: (_global, message, chat) => {
      const isPrivateChat = chat.type === 'chatTypePrivate' || chat.type === 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('help') ?? false;

      return isPrivateChat && hasKeyword;
    },
    reply: () => {
      return Promise.resolve('*操作帮助*\n'
        + '限制：每一个群，一个用户发消息的频率限制为5秒一次\n'
        + '1. 设置转发人, 例如要设置xxx,yyy为转发人, 私发消息"xxx,yyy"给用户,然后回复这一条消息,回复内容为"设置转发人"\n'
        + '2. 设置接收人, 例如要设置xxx,yyy为转发人, 私发消息"xxx,yyy"给用户,然后回复这一条消息,回复内容为"设置接收人"\n'
        + '3. 查看转发人, 直接私发消息"设置接收人"\n'
        + '4. 查看接收人, 直接私发消息"查看接收人"\n');
    },
  },
  {
    match: (_global, message, chat) => {
      const isPrivateChat = chat.type === 'chatTypePrivate' || chat.type === 'chatTypeSecret';
      const hasReplyInfo = Boolean(message.replyInfo?.type === 'message');
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('设置转发人') ?? false;

      return isPrivateChat && hasReplyInfo && hasKeyword;
    },
    reply: async (global, message) => {
      const replyMsgId = getMessageReplyInfo(message)?.replyToMsgId;
      if (!replyMsgId) {
        return '没有回复消息';
      }
      const replyMessage = selectChatMessage(global, message.chatId, replyMsgId);
      if (replyMessage) {
        const replyText = extractMessageTextContent(replyMessage);
        if (replyText) {
          // Parse username(s) into array, handling both comma-separated and single values
          const usernames = replyText.includes(',')
            ? replyText.split(',').map((username) => username.trim())
            : [replyText.trim()];

          // Load existing config and save new rules
          const config = await loadSourceUserConfig();
          config.rules = usernames;
          await saveSourceUserConfig(config);
        }
      }
      return '已存储';
    },
  },
  // 设置接收人
  {
    match: (_global, message, chat) => {
      const isPrivateChat = chat.type === 'chatTypePrivate' || chat.type === 'chatTypeSecret';
      const hasReplyInfo = Boolean(message.replyInfo?.type === 'message');
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('设置接收人') ?? false;

      return isPrivateChat && hasReplyInfo && hasKeyword;
    },
    reply: async (global, message) => {
      const replyMsgId = getMessageReplyInfo(message)?.replyToMsgId;
      if (!replyMsgId) {
        return '没有回复消息';
      }
      const replyMessage = selectChatMessage(global, message.chatId, replyMsgId);
      if (replyMessage) {
        const replyText = extractMessageTextContent(replyMessage);
        if (replyText) {
          // Parse username(s) into array, handling both comma-separated and single values
          const usernames = replyText.includes(',')
            ? replyText.split(',').map((username) => username.trim())
            : [replyText.trim()];

          // Load existing config and save new rules
          const config = await loadTargetUserConfig();
          config.rules = usernames;
          await saveTargetUserConfig(config);
        }
      }
      return '已存储';
    },
  },
  // 查看转发人
  {
    match: (_global, message, chat) => {
      const isPrivateChat = chat.type === 'chatTypePrivate' || chat.type === 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('查看转发人') ?? false;

      return isPrivateChat && hasKeyword;
    },
    reply: async () => {
      const config = await loadSourceUserConfig();
      return `${config.rules}`;
    },
  },
  // 查看接收人
  {
    match: (_global, message, chat) => {
      const isPrivateChat = chat.type === 'chatTypePrivate' || chat.type === 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('查看接收人') ?? false;

      return isPrivateChat && hasKeyword;
    },
    reply: async () => {
      const config = await loadTargetUserConfig();
      return `${config.rules}`;
    },
  },
];

// Auto-reply patterns system
const AUTO_REPLY_PATTERNS: MessagePattern[] = [
  // 转发人消息进行转发
  {
    match: async (global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const hasNoReplyInfo = !message.replyInfo;
      const config = await loadSourceUserConfig();
      const senderUsername = getMessageSender(global, message);
      const isUserInRules = senderUsername ? config.rules.includes(senderUsername) : false;

      return isNotPrivateChat && hasNoReplyInfo && isUserInRules;
    },
    reply: (_global, message, chat) => {
      setTimeout(() => {
        callApi('forwardMessages', {
          fromChat: chat,
          toChat: chat,
          messages: [message],
        });
      }, Math.floor(Math.random() * (3000 - 50 + 1)) + 50);
      return Promise.resolve(undefined);
    },
  },
  // 接收人发的回复消息进行回复
  {
    match: async (global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const hasReplyInfo = Boolean(message.replyInfo?.type === 'message');
      const config = await loadTargetUserConfig();
      const senderUsername = getMessageSender(global, message);
      const isUserInRules = senderUsername ? config.rules.includes(senderUsername) : false;

      return isNotPrivateChat && hasReplyInfo && isUserInRules;
    },
    reply: (global, message, chat) => {
      // 获得消息的内容
      const replyText = extractMessageTextContent(message);
      const replyMsgId = getMessageReplyInfo(message)?.replyToMsgId;
      if (!replyMsgId) {
        return Promise.resolve('没有回复消息');
      }
      const replyMessage = selectChatMessage(global, message.chatId, replyMsgId);
      if (replyMessage) {
        // Add delay to make the response feel more natural
        setTimeout(() => {
          try {
            callApi('sendMessage', {
              chat,
              text: replyText,
              replyInfo: replyMessage.id ? {
                type: 'message',
                replyToMsgId: replyMessage.id,
              } : undefined,
            });
          } catch (error) {
            // Silent error handling to not disrupt normal message flow
          }
        }, Math.floor(Math.random() * (3500 - 50 + 1)) + 50);
      }
      return Promise.resolve(undefined);
    },
  },
];

function getMessageSender(global: any, message: ApiMessage): string | undefined {
  // Get sender information
  const senderId = message.senderId?.toString() || '';
  const senderUser = selectUser(global, senderId);
  return senderUser?.usernames?.[0].username;
}

// Function to handle auto-replies based on message content
export async function handleAutoReply(global: any, message: ApiMessage, chat: ReturnType<typeof selectChat>): Promise<void> {
  if (!chat || message.senderId === global.currentUserId) {
    return; // Don't reply to our own messages or when chat is undefined
  }

  // eslint-disable-next-line no-console
  console.error('Handling auto reply for message7:', message);
  // eslint-disable-next-line no-console
  console.error('Chat:', chat);

  // Create a unique key for rate limiting based on chatId and senderId
  const rateKey = `${chat.id}_${message.senderId}`;
  const now = Date.now();
  const lastReplyTime = lastReplySent.get(rateKey) || 0;

  // // Check if we're still in cooldown period
  // if (now - lastReplyTime < REPLY_COOLDOWN) {
  //   // Skip reply due to rate limiting
  //   return;
  // }

  const isPrivateChat = chat.type === 'chatTypePrivate' || chat.type === 'chatTypeSecret';
  if (isPrivateChat) {
    // Find the first matching pattern and send its reply
    for (const pattern of PRIVATE_AUTO_REPLY_PATTERNS) {
      if (pattern.match(global, message, chat)) {
        const replyText = await pattern.reply(global, message, chat);

        if (replyText) {
          // Add delay to make the response feel more natural
          setTimeout(() => {
            try {
              callApi('sendMessage', {
                chat,
                text: replyText,
                replyInfo: message.id ? {
                  type: 'message',
                  replyToMsgId: message.id,
                } : undefined,
              });
            } catch (error) {
              // Silent error handling to not disrupt normal message flow
            }
          }, Math.floor(Math.random() * (2000 - 50 + 1)) + 50);
        }
        break; // Only use the first matching pattern
      }
    }
  } else {
    // Find the first matching pattern and send its reply
    for (const pattern of AUTO_REPLY_PATTERNS) {
      if (await pattern.match(global, message, chat)) {
        const replyText = await pattern.reply(global, message, chat);

        // Update the last reply time for this chat/sender
        lastReplySent.set(rateKey, now);

        if (replyText) {
          // Add delay to make the response feel more natural
          setTimeout(() => {
            try {
              callApi('sendMessage', {
                chat,
                text: replyText,
                replyInfo: message.id ? {
                  type: 'message',
                  replyToMsgId: message.id,
                } : undefined,
              });
            } catch (error) {
              // Silent error handling to not disrupt normal message flow
            }
          }, Math.floor(Math.random() * (2000 - 50 + 1)) + 50);
        }

        break; // Only use the first matching pattern
      }
    }
  }
}
