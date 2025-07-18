/* eslint-disable max-len */
import type { ApiMessage } from '../../../api/types';
import type { selectChat } from '../../selectors';

import {
  loadSourceUserConfig,
  loadTargetUserConfig,
  saveSourceUserConfig,
  saveTargetUserConfig,
} from '../../../config/forwardConfig';
import { callApi } from '../../../api/gramjs';
import { fetchMessage } from '../../../api/gramjs/methods/messages';
import { isForwardedMessage } from '../../helpers/messages';
import { getMessageReplyInfo } from '../../helpers/replies';
import {
  selectCanForwardMessage,
  selectChatFullInfo, selectChatLastMessageId, selectChatMessage, selectChatMessages,
  selectForwardedMessageIdsByGroupId,
  selectForwardedSender, selectForwardsCanBeSentToChat, selectIsChatWithBot, selectIsTrustedBot, selectMessageReplyInfo,
  selectReplyMessage,
  selectUser,
} from '../../selectors';
import { isUserBot } from '../../helpers/users';

// 全局文本缓存，使用WeakMap自动清理未使用的消息
const messageTextCache = new WeakMap<ApiMessage, string>();

// 内存清理机制: 限制处理频率避免过载
let lastProcessTime = 0;
const PROCESS_THROTTLE_MS = 100; // 100ms 节流

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

function extractRawMessageText(message: ApiMessage): string | undefined {
  // 检查缓存
  const cached = messageTextCache.get(message);
  if (cached !== undefined) {
    return cached;
  }

  const {
    text,
    photo,
    video,
    audio,
    voice,
    document,
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

  const result = rawText || undefined;
  
  // 缓存结果
  if (result !== undefined) {
    messageTextCache.set(message, result);
  }

  return result;
}

// Function to extract text content from any message type
function extractMessageTextContent(message: ApiMessage): string | undefined {
  const {
    text,
    photo,
    video,
    audio,
    voice,
    document,
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
  const cleanedText = rawText.replace(/@[\w_]+\s?/g, '')
    .trim();

  return cleanedText || rawText; // If cleaning removed all content, return original
}

// Auto-reply patterns system
const AUTO_REPLY_PATTERNS: MessagePattern[] = [
  {
    match: (_global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.toLowerCase() === 'help';
      return isNotPrivateChat && hasKeyword;
    },
    reply: async () => {
      return `可用指令列表：
1. 清除接收人 - 清除当前群组的所有接收人
2. 清除转发人 - 清除当前群组的所有转发人
3. 添加转发人 - 添加转发人 @xxxx
4. 添加接收人 - 添加接收人 @xxxx
5. 查看转发人 - 查看当前群组的所有转发人
6. 查看接收人 - 查看当前群组的所有接收人
7. 添加转发过滤 - 添加转发过滤（回复要过滤的消息），添加后包含该内容的消息不会被转发
8. 添加接收过滤 - 添加接收过滤（回复要过滤的消息），添加后包含该内容的消息不会被回复
9. 添加接收包含 - 添加接收包含（回复要包含的消息），添加后必须包含该内容的消息才会被接收处理
10. 查看转发过滤 - 查看当前群组的所有转发过滤
11. 查看接收过滤 - 查看当前群组的所有接收过滤
12. 查看接收包含 - 查看当前群组的所有接收包含`;
    },
  },
  {
    match: (_global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('查看接收过滤') ?? false;

      return isNotPrivateChat && hasKeyword;
    },
    reply: async (_global, message) => {
      const config = await loadTargetUserConfig();
      const chatId = message.chatId;

      if (!config.filters || !config.filters[chatId] || config.filters[chatId].length === 0) {
        return '当前群组没有设置接收过滤';
      }

      const filters = config.filters[chatId];
      return `当前群组的接收过滤:\n${filters.join('\n')}`;
    },
  },
  {
    match: (_global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('查看转发过滤') ?? false;

      return isNotPrivateChat && hasKeyword;
    },
    reply: async (_global, message) => {
      const config = await loadSourceUserConfig();
      const chatId = message.chatId;

      if (!config.filters || !config.filters[chatId] || config.filters[chatId].length === 0) {
        return '当前群组没有设置转发过滤';
      }

      const filters = config.filters[chatId];
      return `当前群组的转发过滤:\n${filters.join('\n')}`;
    },
  },
  {
    match: (_global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('查看接收包含') ?? false;

      return isNotPrivateChat && hasKeyword;
    },
    reply: async (_global, message) => {
      const config = await loadTargetUserConfig();
      const chatId = message.chatId;

      if (!config.includes || !config.includes[chatId] || config.includes[chatId].length === 0) {
        return '当前群组没有设置接收包含';
      }

      const includes = config.includes[chatId];
      return `当前群组的接收包含:\n${includes.join('\n')}`;
    },
  },
  {
    match: (_global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('添加接收包含') ?? false;
      const hasReplyInfo = Boolean(message.replyInfo?.type === 'message');
      return isNotPrivateChat && hasKeyword && hasReplyInfo;
    },
    reply: async (global, message) => {
      const chatId = message.chatId;
      const config = await loadTargetUserConfig();
      const replyMessage = selectReplyMessage(global, message);

      if (!replyMessage) {
        return '请回复要添加包含的消息';
      }

      const replyText = extractMessageTextContent(replyMessage);
      if (!replyText) {
        return '无法获取回复消息的内容';
      }

      // Initialize include array if it doesn't exist
      if (!config.includes) {
        config.includes = {};
      }
      if (!config.includes[chatId]) {
        config.includes[chatId] = [];
      }

      // Add the text to includes if not already present
      if (!config.includes[chatId].includes(replyText)) {
        config.includes[chatId].push(replyText);
        await saveTargetUserConfig(config);
        return `已添加接收包含: ${replyText}`;
      }

      return '该包含文本已存在';
    },
  },

  {
    match: (_global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('添加接收过滤') ?? false;
      const hasReplyInfo = Boolean(message.replyInfo?.type === 'message');
      return isNotPrivateChat && hasKeyword && hasReplyInfo;
    },
    reply: async (global, message) => {
      const chatId = message.chatId;
      const config = await loadTargetUserConfig();
      const replyMessage = selectReplyMessage(global, message);

      if (!replyMessage) {
        return '请回复要添加过滤的消息';
      }

      const replyText = extractMessageTextContent(replyMessage);
      if (!replyText) {
        return '无法获取回复消息的内容';
      }

      // Initialize filter array if it doesn't exist
      if (!config.filters) {
        config.filters = {};
      }
      if (!config.filters[chatId]) {
        config.filters[chatId] = [];
      }

      // Add the text to filters if not already present
      if (!config.filters[chatId].includes(replyText)) {
        config.filters[chatId].push(replyText);
        await saveTargetUserConfig(config);
        return `已添加接收过滤: ${replyText}`;
      }

      return '该过滤文本已存在';
    },
  },

  {
    match: (_global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('添加转发过滤') ?? false;
      const hasReplyInfo = Boolean(message.replyInfo?.type === 'message');
      return isNotPrivateChat && hasKeyword && hasReplyInfo;
    },
    reply: async (global, message) => {
      const chatId = message.chatId;
      const config = await loadSourceUserConfig();
      const replyMessage = selectReplyMessage(global, message);

      if (!replyMessage) {
        return '请回复要添加过滤的消息';
      }

      const replyText = extractMessageTextContent(replyMessage);
      if (!replyText) {
        return '无法获取回复消息的内容';
      }

      // Initialize filter array if it doesn't exist
      if (!config.filters) {
        config.filters = {};
      }
      if (!config.filters[chatId]) {
        config.filters[chatId] = [];
      }

      // Add the text to filters if not already present
      if (!config.filters[chatId].includes(replyText)) {
        config.filters[chatId].push(replyText);
        await saveSourceUserConfig(config);
        return `已添加转发过滤: ${replyText}`;
      }

      return '该过滤文本已存在';
    },
  },
  // 清除接收人
  {
    match: (_global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('清除接收人') ?? false;
      return isNotPrivateChat && hasKeyword;
    },
    reply: async (global, message) => {
      const chatId = message.chatId;
      const config = await loadTargetUserConfig();

      // Clear rules for this chat
      if (config.rules[chatId]) {
        delete config.rules[chatId];
        await saveTargetUserConfig(config);
        return '已清除所有接收人';
      }

      return '当前没有设置接收人';
    },
  },
  // 清除转发人
  {
    match: (_global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('清除转发人') ?? false;

      return isNotPrivateChat && hasKeyword;
    },
    reply: async (global, message) => {
      const chatId = message.chatId;
      const config = await loadSourceUserConfig();

      // Clear rules for this chat
      if (config.rules[chatId]) {
        delete config.rules[chatId];
        await saveSourceUserConfig(config);
        return '已清除所有转发人';
      }

      return '当前没有设置转发人';
    },
  },
  // 添加接收人
  {
    match: (_global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('添加接收人') ?? false;

      return isNotPrivateChat && hasKeyword;
    },
    reply: async (global, message) => {
      const messageText = extractRawMessageText(message);
      if (!messageText) return undefined;

      // Extract usernames after @, handling multiple @mentions
      const usernames = messageText.match(/@\s*([^\s@]+)/g)
        ?.map((u) => u.replace(/@\s*/, '')) || [];
      if (usernames.length === 0) return '请指定要添加的用户名';

      // Load existing config
      const config = await loadTargetUserConfig();
      const chatId = message.chatId;

      // Initialize rules array for this chat if it doesn't exist
      if (!config.rules[chatId]) {
        config.rules[chatId] = [];
      }

      const addedUsers = [];
      const existingUsers = [];

      // Add usernames if not already in rules
      for (const username of usernames) {
        if (!config.rules[chatId].includes(username)) {
          config.rules[chatId].push(username);
          addedUsers.push(username);
        } else {
          existingUsers.push(username);
        }
      }

      await saveTargetUserConfig(config);

      const responses = [];
      if (addedUsers.length > 0) {
        responses.push(`已将 ${addedUsers.map((u) => `@${u}`)
          .join(', ')} 添加为接收人`);
      }
      if (existingUsers.length > 0) {
        responses.push(`${existingUsers.map((u) => `@${u}`)
          .join(', ')} 已经是接收人`);
      }
      return responses.join('\n');
    },
  },
  // 查看接收人
  {
    match: (_global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('查看接收人') ?? false;

      return isNotPrivateChat && hasKeyword;
    },
    reply: async (global, message) => {
      const config = await loadTargetUserConfig();
      const chatId = message.chatId;
      const users = config.rules[chatId] || [];

      if (users.length === 0) {
        return '当前群组没有设置接收人';
      }

      return `当前群组的接收人：\n${users.map((u) => `@${u}`)
        .join('\n')}`;
    },
  },
  // 添加转发人
  {
    match: (_global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('添加转发人') ?? false;

      return isNotPrivateChat && hasKeyword;
    },
    reply: async (global, message) => {
      const messageText = extractRawMessageText(message);
      if (!messageText) return undefined;

      // Extract usernames after @, handling multiple @mentions
      const usernames = messageText.match(/@\s*([^\s@]+)/g)
        ?.map((u) => u.replace(/@\s*/, '')) || [];
      if (usernames.length === 0) return '请指定要追加的用户名';

      // Load existing config
      const config = await loadSourceUserConfig();
      const chatId = message.chatId;

      // Initialize rules array for this chat if it doesn't exist
      if (!config.rules[chatId]) {
        config.rules[chatId] = [];
      }

      const addedUsers = [];
      const existingUsers = [];

      // Add usernames if not already in rules
      for (const username of usernames) {
        if (!config.rules[chatId].includes(username)) {
          config.rules[chatId].push(username);
          addedUsers.push(username);
        } else {
          existingUsers.push(username);
        }
      }

      await saveSourceUserConfig(config);

      const responses = [];
      if (addedUsers.length > 0) {
        responses.push(`已将 ${addedUsers.map((u) => `@${u}`)
          .join(', ')} 添加为转发人`);
      }
      if (existingUsers.length > 0) {
        responses.push(`${existingUsers.map((u) => `@${u}`)
          .join(', ')} 已经是转发人`);
      }
      return responses.join('\n');
    },
  },
  // 查看转发人
  {
    match: (_global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('查看转发人') ?? false;

      return isNotPrivateChat && hasKeyword;
    },
    reply: async (_global, message) => {
      const config = await loadSourceUserConfig();
      const chatId = message.chatId;

      if (!config.rules[chatId] || config.rules[chatId].length === 0) {
        return '当前群组没有设置转发人';
      }

      const usernames = config.rules[chatId];
      return `当前群组的转发人:\n${usernames.map((u) => `@${u}`)
        .join('\n')}`;
    },
  },
  // 转发人消息进行转发
  {
    match: async (global, message, chat) => {
      const isNotPrivateChat = chat.type !== 'chatTypePrivate' && chat.type !== 'chatTypeSecret';
      const config = await loadSourceUserConfig();
      const senderUsername = getMessageSender(global, message);
      const chatId = message.chatId;
      const isUserInRules = (senderUsername && config.rules[chatId]) ? config.rules[chatId].includes(senderUsername) : false;
      const messageText = extractMessageTextContent(message);
      const hasOrderNumber = messageText ? /\b(?=[A-Za-z0-9_-]{6,40}\b)(?=.*[A-Za-z])[A-Za-z0-9_-]{6,40}\b|\b\d{10,40}\b/.test(messageText) : false;

      if (config.filters && config.filters[chat.id]) {
        const isInFilters = config.filters[chat.id].some((filter) => messageText?.toLowerCase().includes(filter.toLowerCase()));
        if (isInFilters) {
          return false;
        }
      }

      return isNotPrivateChat && isUserInRules && hasOrderNumber;
    },
    reply: async (_global, message, chat) => {
      // Check if message is already forwarded and not from current user
      const isForwarded = Boolean(message.forwardInfo);
      // 检查消息是否由当前用户发送，通过message.isOutgoing属性判断
      // message.isOutgoing为true表示消息是由当前用户发出的
      const isFromCurrentUser = message.isOutgoing;

      if (isForwarded || isFromCurrentUser) {
        return Promise.resolve(undefined);
      }

      const messageText = extractMessageTextContent(message);
      const config = await loadSourceUserConfig();
      const chatId = message.chatId;

      if (config.filters && config.filters[chatId]) {
        const hasFilterMatch = config.filters[chatId].some((filter) => messageText?.toLowerCase().includes(filter.toLowerCase()));
        if (hasFilterMatch) {
          return Promise.resolve(undefined);
        }
      }

      callApi('forwardMessages', {
        fromChat: chat,
        toChat: chat,
        messages: [message],
      })
        .catch((error) => {
          // eslint-disable-next-line no-console
          console.error('Error forwarding message:', error);
        });

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
      const chatId = message.chatId;
      const isUserInRules = (senderUsername && config.rules[chatId]) ? config.rules[chatId].includes(senderUsername) : false;
      const messageText = extractMessageTextContent(message);
      const hasCallbackKeywords = messageText ? messageText.includes('回调') || messageText.includes('完成') || messageText.includes('单图不符') : false;

      const hasIncludeMatch = config.includes && config.includes[chatId]
        ? config.includes[chatId].some((include) => messageText?.toLowerCase().includes(include.toLowerCase()))
        : true;

      if (config.filters && config.filters[chat.id]) {
        const hasFilterMatch = config.filters[chat.id].some((filter) => messageText?.toLowerCase().includes(filter.toLowerCase()));
        if (hasFilterMatch) {
          return false;
        }
      }

      return isNotPrivateChat && hasReplyInfo && isUserInRules && hasCallbackKeywords && hasIncludeMatch;
    },
    reply: async (global, message, chat) => {
      // 获得消息的内容
      const replyText = extractMessageTextContent(message);
      if (replyText?.includes('消息已转发')) {
        return Promise.resolve(undefined);
      }

      const config = await loadTargetUserConfig();
      if (config.filters && config.filters[chat.id]) {
        const hasFilterMatch = config.filters[chat.id].some((filter) => replyText?.toLowerCase().includes(filter.toLowerCase()));
        if (hasFilterMatch) {
          return Promise.resolve(undefined);
        }
      }

      const replyMessage = selectReplyMessage(global, message);
      if (replyMessage) {
        const replyMessageText = extractRawMessageText(replyMessage);
        const chatMessages = selectChatMessages(global, chat.id);
        let foundMessageId: number | undefined;

        // 内存优化: 直接遍历消息ID，避免创建大数组
        const messageIds = Object.keys(chatMessages)
          .map(Number)
          .sort((a, b) => b - a)
          .slice(0, 50); // 进一步减少搜索范围到50条

        // 直接遍历，避免创建临时数据结构
        for (const id of messageIds) {
          const msg = chatMessages[id];
          if (!msg || msg.forwardInfo || msg.isOutgoing) continue;

          const msgText = extractRawMessageText(msg);
          if (msgText === replyMessageText) {
            foundMessageId = id;
            break;
          }
        }

        if (!foundMessageId) {
          return Promise.resolve(undefined);
        }

        try {
          await callApi('sendMessage', {
            chat,
            text: replyText,
            replyInfo: {
              type: 'message',
              replyToMsgId: foundMessageId,
            },
          });
        } catch (error) {
          // Silent error handling to not disrupt normal message flow
        }
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

  // 节流检查：限制处理频率避免内存过载
  const now = Date.now();
  if (now - lastProcessTime < PROCESS_THROTTLE_MS) {
    return;
  }
  lastProcessTime = now;

  const isPrivateChat = chat.type === 'chatTypePrivate' || chat.type === 'chatTypeSecret';
  if (isPrivateChat) {
    // Find the first matching pattern and send its reply
  } else {
    // Find the first matching pattern and send its reply
    for (const pattern of AUTO_REPLY_PATTERNS) {
      if (await pattern.match(global, message, chat)) {
        const replyText = await pattern.reply(global, message, chat);

        if (replyText) {
          try {
            await callApi('sendMessage', {
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
        }

        break; // Only use the first matching pattern
      }
    }
  }
}
