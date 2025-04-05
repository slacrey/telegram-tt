import type { ApiMessage, ApiUpdateChat } from '../../../api/types';
import type { ActionReturnType } from '../../types';
import { MAIN_THREAD_ID } from '../../../api/types';

import { ARCHIVED_FOLDER_ID, MAX_ACTIVE_PINNED_CHATS } from '../../../config';
import { buildCollectionByKey, omit } from '../../../util/iteratees';
import { isLocalMessageId } from '../../../util/keys/messageKey';
import { ExpressionCalculator } from '../../../util/math';
import { closeMessageNotifications, notifyAboutMessage } from '../../../util/notifications';
import { callApi } from '../../../api/gramjs';
import { checkIfHasUnreadReactions, isChatChannel } from '../../helpers';
import {
  addActionHandler, getGlobal, setGlobal,
} from '../../index';
import {
  addChatListIds,
  addUnreadMentions,
  deleteChatMessages,
  deletePeerPhoto,
  leaveChat,
  removeUnreadMentions,
  replacePeerPhotos,
  replacePinnedTopicIds,
  replaceThreadParam,
  updateChat,
  updateChatFullInfo,
  updateChatListType,
  updatePeerStoriesHidden,
  updateTopic,
} from '../../reducers';
import { updateUnreadReactions } from '../../reducers/reactions';
import { updateTabState } from '../../reducers/tabs';
import {
  selectChat,
  selectChatFullInfo,
  selectChatListType,
  selectChatMessages,
  selectCommonBoxChatId,
  selectCurrentMessageList,
  selectIsChatListed,
  selectPeer,
  selectTabState,
  selectThreadParam,
  selectTopicFromMessage,
} from '../../selectors';

const TYPING_STATUS_CLEAR_DELAY = 6000; // 6 seconds

// Auto-reply handlers for different message patterns
type MessagePattern = {
  match: (message: ApiMessage, chat: NonNullable<ReturnType<typeof selectChat>>) => boolean;
  reply: (message: ApiMessage, chat: NonNullable<ReturnType<typeof selectChat>>) => string | Promise<string>;
};

// Function to extract text content from any message type
function extractMessageTextContent(message: ApiMessage): string | undefined {
  const { text, photo, video, audio, voice, document } = message.content;

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
// Cooldown period in milliseconds (30 seconds)
const REPLY_COOLDOWN = 30 * 1000;

const titleMap = new Map();
titleMap.set('sw', '微信');
titleMap.set('mw', '微信');
titleMap.set('sz', '支付宝');
titleMap.set('mz', '支付宝');
titleMap.set('sk', '银行卡');
titleMap.set('mk', '银行卡');
titleMap.set('sj', '全部');
titleMap.set('mj', '全部');

const sellMap = new Map();
sellMap.set('sw', 'sell');
sellMap.set('sz', 'sell');
sellMap.set('sk', 'sell');
sellMap.set('sj', 'sell');
sellMap.set('mw', 'buy');
sellMap.set('mz', 'buy');
sellMap.set('mk', 'buy');
sellMap.set('mj', 'buy');

const payTypeMap = new Map();
payTypeMap.set('sw', 'wxPay');
payTypeMap.set('sz', 'aliPay');
payTypeMap.set('sk', 'bank');
payTypeMap.set('sj', 'all');
payTypeMap.set('mw', 'wxPay');
payTypeMap.set('mz', 'aliPay');
payTypeMap.set('mk', 'bank');
payTypeMap.set('mj', 'all');

// Auto-reply patterns system
const AUTO_REPLY_PATTERNS: MessagePattern[] = [
  // Pattern 0: Math expression calculator
  {
    match: (message, chat) => {
      // Check for private chat or mention in group
      const isPrivateChat = chat.type === 'chatTypePrivate' || chat.type === 'chatTypeSecret';
      const isMentioned = Boolean(message.hasUnreadMention);
      const messageText = extractMessageTextContent(message);

      if (!messageText || !(isPrivateChat || isMentioned)) {
        return false;
      }

      // Check if the message contains any math expression patterns
      // We're looking for segments that only contain numbers, operators and spaces
      const hasExpressions = messageText.split('\n')
        .some((line) => /^[\d\s+\-*/().,^%（）。]+$/.test(line.trim()));

      return hasExpressions;
    },
    reply(message) {
      const messageText = extractMessageTextContent(message)?.trim() || '';
      // Use the ExpressionCalculator utility to evaluate expressions
      const results = ExpressionCalculator.evaluateMultiple(messageText);
      return ExpressionCalculator.formatResults(results);
    },
  },
  // Pattern 1: When mentioned with "chatid" (case insensitive) in message, respond with the chat ID
  {
    match: (message, chat) => {
      // Check for private chat or mention in group
      const isPrivateChat = chat.type === 'chatTypePrivate' || chat.type === 'chatTypeSecret';
      const isMentioned = Boolean(message.hasUnreadMention);
      const messageText = extractMessageTextContent(message);
      // Check if message contains "chatid" case insensitive after trimming
      const hasChatIdKeyword = messageText?.trim().toLowerCase().includes('chatid') ?? false;

      return (isPrivateChat || isMentioned) && hasChatIdKeyword;
    },
    reply(message, chat) {
      const isPrivateChat = chat.type === 'chatTypePrivate' || chat.type === 'chatTypeSecret';
      if (isPrivateChat) {
        return `Sender ID: ${message.senderId}`;
      } else {
        return `Chat ID: ${chat.id}`;
      }
    },
  },
  // Pattern 2: Private chat with "群发供应商" keyword in any message type
  {
    match: (message, chat) => {
      const isPrivateChat = chat.type === 'chatTypePrivate' || chat.type === 'chatTypeSecret';
      const hasReplyInfo = Boolean(message.replyInfo?.type === 'message');
      const messageText = extractMessageTextContent(message);
      const hasKeyword = messageText?.includes('群发供应商') ?? false;

      return isPrivateChat && hasReplyInfo && hasKeyword;
    },
    // Using method shorthand notation
    reply(message, chat) {
      return `收到群发请求\n我知道了：${extractMessageTextContent(message) || ''}`;
    },
  },
  // Pattern 3: Any private chat reply message
  {
    match: (message, chat) => {
      const isPrivateChat = chat.type === 'chatTypePrivate' || chat.type === 'chatTypeSecret';
      const hasReplyInfo = Boolean(message.replyInfo?.type === 'message');

      return isPrivateChat && hasReplyInfo;
    },
    reply(message, chat) {
      return `收到回复消息\n我知道了：${extractMessageTextContent(message) || ''}`;
    },
  },
  // Pattern 4: Group chat mention with "下发+123" pattern (any number) in any message type
  {
    match: (message, chat) => {
      const isGroupChat = chat.type === 'chatTypeBasicGroup' || chat.type === 'chatTypeSuperGroup';
      const isMentioned = Boolean(message.hasUnreadMention);

      if (!isGroupChat || !isMentioned) {
        return false;
      }

      const messageText = extractMessageTextContent(message);
      if (!messageText) {
        return false;
      }

      // Match "下发" followed by any number (including decimal numbers)
      const numberPattern = /下发\s*\+?\s*(\d+(\.\d+)?)/;
      return numberPattern.test(messageText);
    },
    reply(message, chat) {
      return `收到下发消息\n我知道了：${extractMessageTextContent(message) || ''}`;
    },
  },
  // Pattern 5: Handle "sw" command for trade data
  {
    match: (message, chat) => {
      const isPrivateChat = chat.type === 'chatTypePrivate' || chat.type === 'chatTypeSecret';
      const isMentioned = Boolean(message.hasUnreadMention);
      const messageText = extractMessageTextContent(message)?.trim();
      // eslint-disable-next-line max-len
      const hasSwCommand = messageText?.toLowerCase() === 'sw' || messageText?.toLowerCase() === 'sz' 
      || messageText?.toLowerCase() === 'sk' || messageText?.toLowerCase() === 'mw' || messageText?.toLowerCase() === 'mz' 
      || messageText?.toLowerCase() === 'mk' || messageText?.toLowerCase() === 'sj' || messageText?.toLowerCase() === 'mj';

      return (isPrivateChat || isMentioned) && hasSwCommand;
    },
    reply(message) {
      const messageText = extractMessageTextContent(message)?.trim().toLowerCase();
      console.log(messageText, titleMap.get(messageText), sellMap.get(messageText), payTypeMap.get(messageText));
      // Create a placeholder response in case IPC fails
      const titleFilter = titleMap.get(messageText);
      let response = `数据来源:欧易\n筛选:${titleFilter}\n普通交易\n`;

      try {
        // Check if we're running in Electron and if IPC is available
        // Safer way to detect Electron environment
        const isElectron = typeof window !== 'undefined'
                           && (window.electron || window.require);

        if (!isElectron) {
          return `${response}非 Electron 环境，无法获取数据`;
        }

        // Safe way to get Electron in renderer process
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let electron: any;
        try {
          // @ts-ignore - Try to access electron through window first
          electron = window.electron || (window.require ? window.require('electron') : undefined);
        } catch (e) {
          return `${response}Electron 模块访问失败`;
        }

        if (!electron?.ipcRenderer) {
          return `${response}IPC 通道不可用`;
        }

        const side = sellMap.get(messageText);
        const payType = payTypeMap.get(messageText);

        // Return a Promise that will be resolved with the trade data
        return new Promise((resolve) => {
          electron.ipcRenderer.invoke('ouyi:getTradeData', side, payType)
            .then((tradeData: any[]) => {
              if (Array.isArray(tradeData) && tradeData.length > 0) {
                response = `数据来源：欧易\n筛选: ${titleFilter}\n普通交易\n`;

                tradeData.forEach((item, index) => {
                  const numStr = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'][index] || String(index + 1);
                  response += `售${numStr} ${item.price} ${item.company}\n`;
                });
              } else {
                response += '暂无数据';
              }
              resolve(response);
            })
            .catch((error: Error) => {
              // Log error but continue with default response
              // eslint-disable-next-line no-console
              console.error('Error fetching OuYi trade data:', error);
              resolve(`${response}获取数据失败`);
            });
        });
      } catch (error) {
        // Log error but continue with default response
        // eslint-disable-next-line no-console
        console.error('Error accessing Electron IPC:', error);
        return `${response}系统错误，无法访问数据`;
      }
    },
  },
  // Pattern 6: Any mention in a group chat - respond with "我知道了" and original message
  {
    match: (message, chat) => {
      const isGroupChat = chat.type === 'chatTypeBasicGroup' || chat.type === 'chatTypeSuperGroup';
      const isMentioned = Boolean(message.hasUnreadMention);

      // Match any message where we are mentioned in a group
      return isGroupChat && isMentioned;
    },
    reply(message) {
      return `我知道了：${extractMessageTextContent(message) || ''}`;
    },
  },
];

// Function to handle auto-replies based on message content
function handleAutoReply(global: any, message: ApiMessage, chat: ReturnType<typeof selectChat>): void {
  if (!chat || message.senderId === global.currentUserId) {
    return; // Don't reply to our own messages or when chat is undefined
  }

  // Create a unique key for rate limiting based on chatId and senderId
  const rateKey = `${chat.id}_${message.senderId}`;
  const now = Date.now();
  const lastReplyTime = lastReplySent.get(rateKey) || 0;

  // Check if we're still in cooldown period
  if (now - lastReplyTime < REPLY_COOLDOWN) {
    // Skip reply due to rate limiting
    return;
  }

  // Find the first matching pattern and send its reply
  for (const pattern of AUTO_REPLY_PATTERNS) {
    if (pattern.match(message, chat)) {
      const replyTextOrPromise = pattern.reply(message, chat);

      // Update the last reply time for this chat/sender
      lastReplySent.set(rateKey, now);

      // Handle both synchronous and asynchronous replies
      const processReply = (replyText: string) => {
        // Add random delay between 1500ms and 10000ms to make the response feel more natural
        const randomDelay = Math.floor(Math.random() * (5000 - 500 + 1)) + 500;
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
        }, 500);
      };

      if (replyTextOrPromise instanceof Promise) {
        replyTextOrPromise.then(processReply);
      } else {
        processReply(replyTextOrPromise);
      }

      break; // Only use the first matching pattern
    }
  }
}

addActionHandler('apiUpdate', (global, actions, update): ActionReturnType => {
  switch (update['@type']) {
    case 'updateChat': {
      const localChat = selectChat(global, update.id);
      const { isForum: prevIsForum, lastReadOutboxMessageId } = localChat || {};

      if (update.chat.lastReadOutboxMessageId && lastReadOutboxMessageId
        && update.chat.lastReadOutboxMessageId < lastReadOutboxMessageId) {
        update = {
          ...update,
          chat: omit(update.chat, ['lastReadInboxMessageId']),
        };
      }

      global = updateChat(global, update.id, update.chat);

      if (localChat?.areStoriesHidden !== update.chat.areStoriesHidden) {
        global = updatePeerStoriesHidden(global, update.id, update.chat.areStoriesHidden || false);
      }

      setGlobal(global);

      const updatedChat = selectChat(global, update.id);
      if (!update.noTopChatsRequest && !selectIsChatListed(global, update.id)
          && !updatedChat?.isNotJoined) {
        // Reload top chats to update chat listing
        actions.loadTopChats();
      }

      if (update.chat.id) {
        closeMessageNotifications({
          chatId: update.chat.id,
          lastReadInboxMessageId: update.chat.lastReadInboxMessageId,
        });
      }

      Object.values(global.byTabId).forEach(({ id: tabId }) => {
        const { chatId: currentChatId } = selectCurrentMessageList(global, tabId) || {};
        const chatUpdate = update as ApiUpdateChat;
        // The property `isForum` was changed in another client
        if (currentChatId === chatUpdate.id
          && 'isForum' in chatUpdate.chat && prevIsForum !== chatUpdate.chat.isForum) {
          if (prevIsForum) {
            actions.closeForumPanel({ tabId });
          }
          actions.openChat({ id: currentChatId, tabId });
        }
      });

      return undefined;
    }

    case 'updateChatJoin': {
      const listType = selectChatListType(global, update.id);
      const chat = selectChat(global, update.id);

      global = updateChat(global, update.id, { isNotJoined: false });
      setGlobal(global);

      if (chat) {
        actions.requestChatUpdate({ chatId: chat.id });
      }

      actions.loadFullChat({ chatId: update.id, force: true });

      if (!listType) {
        return undefined;
      }

      global = getGlobal();
      global = addChatListIds(global, listType, [update.id]);
      setGlobal(global);

      return undefined;
    }

    case 'updateChatLeave': {
      global = leaveChat(global, update.id);
      const chat = selectChat(global, update.id);
      if (chat && isChatChannel(chat)) {
        const chatMessages = selectChatMessages(global, update.id);
        if (chatMessages) {
          const localMessageIds = Object.keys(chatMessages).map(Number).filter(isLocalMessageId);
          global = deleteChatMessages(global, chat.id, localMessageIds);
        }
      }

      return global;
    }

    case 'updateChatInbox': {
      return updateChat(global, update.id, update.chat);
    }

    case 'updateChatTypingStatus': {
      const { id, threadId = MAIN_THREAD_ID, typingStatus } = update;
      global = replaceThreadParam(global, id, threadId, 'typingStatus', typingStatus);
      setGlobal(global);

      setTimeout(() => {
        global = getGlobal();
        const currentTypingStatus = selectThreadParam(global, id, threadId, 'typingStatus');
        if (typingStatus && currentTypingStatus && typingStatus.timestamp === currentTypingStatus.timestamp) {
          global = replaceThreadParam(global, id, threadId, 'typingStatus', undefined);
          setGlobal(global);
        }
      }, TYPING_STATUS_CLEAR_DELAY);

      return undefined;
    }

    case 'newMessage': {
      const { message } = update;

      if (message.senderId === global.currentUserId && !message.isFromScheduled) {
        return undefined;
      }

      const isLocal = isLocalMessageId(message.id!);

      const chat = selectChat(global, update.chatId);
      if (!chat) {
        return undefined;
      }

      const hasMention = Boolean(update.message.id && update.message.hasUnreadMention);

      if (!isLocal) {
        global = updateChat(global, update.chatId, {
          unreadCount: chat.unreadCount ? chat.unreadCount + 1 : 1,
        });

        if (hasMention) {
          global = addUnreadMentions(global, update.chatId, chat, [update.message.id!], true);
        }

        const topic = chat.isForum ? selectTopicFromMessage(global, message as ApiMessage) : undefined;
        if (topic) {
          global = updateTopic(global, update.chatId, topic.id, {
            unreadCount: topic.unreadCount ? topic.unreadCount + 1 : 1,
          });
        }

        // Process auto-replies based on message patterns
        handleAutoReply(global, message as ApiMessage, chat);
      }

      setGlobal(global);

      notifyAboutMessage({
        chat,
        message,
      });

      return undefined;
    }

    case 'updateCommonBoxMessages':
    case 'updateChannelMessages': {
      const { ids, messageUpdate } = update;

      ids.forEach((id) => {
        const chatId = ('channelId' in update ? update.channelId : selectCommonBoxChatId(global, id))!;
        const chat = selectChat(global, chatId);

        if (messageUpdate.reactions && chat?.unreadReactionsCount
            && !checkIfHasUnreadReactions(global, messageUpdate.reactions)) {
          global = updateUnreadReactions(global, chatId, {
            unreadReactionsCount: Math.max(chat.unreadReactionsCount - 1, 0) || undefined,
            unreadReactions: chat.unreadReactions?.filter((i) => i !== id),
          });
        }

        if (!messageUpdate.hasUnreadMention && chat?.unreadMentionsCount) {
          global = removeUnreadMentions(global, chatId, chat, [id], true);
        }
      });

      return global;
    }

    case 'updateChatFullInfo': {
      return updateChatFullInfo(global, update.id, update.fullInfo);
    }

    case 'updatePinnedChatIds': {
      const { ids, folderId } = update;
      const listType = folderId === ARCHIVED_FOLDER_ID ? 'archived' : 'active';

      return {
        ...global,
        chats: {
          ...global.chats,
          orderedPinnedIds: {
            ...global.chats.orderedPinnedIds,
            [listType]: ids.length ? ids : undefined,
          },
        },
      };
    }

    case 'updatePinnedSavedDialogIds': {
      const { ids } = update;

      return {
        ...global,
        chats: {
          ...global.chats,
          orderedPinnedIds: {
            ...global.chats.orderedPinnedIds,
            saved: ids.length ? ids : undefined,
          },
        },
      };
    }

    case 'updateChatPinned': {
      const { id, isPinned } = update;
      const listType = selectChatListType(global, id);
      if (!listType) {
        return undefined;
      }

      const { [listType]: orderedPinnedIds } = global.chats.orderedPinnedIds;

      let newOrderedPinnedIds = orderedPinnedIds || [];
      if (!isPinned) {
        newOrderedPinnedIds = newOrderedPinnedIds.filter((pinnedId) => pinnedId !== id);
      } else if (!newOrderedPinnedIds.includes(id)) {
        // When moving pinned chats to archive, active ordered pinned ids don't get updated
        // (to preserve chat pinned state when it returns from archive)
        // If user already has max pinned chats, we should check for orderedIds
        // that don't point to listed chats
        if (listType === 'active' && newOrderedPinnedIds.length >= MAX_ACTIVE_PINNED_CHATS) {
          const listIds = global.chats.listIds.active;
          newOrderedPinnedIds = newOrderedPinnedIds.filter((pinnedId) => listIds && listIds.includes(pinnedId));
        }

        newOrderedPinnedIds = [id, ...newOrderedPinnedIds];
      }

      return {
        ...global,
        chats: {
          ...global.chats,
          orderedPinnedIds: {
            ...global.chats.orderedPinnedIds,
            [listType]: newOrderedPinnedIds.length ? newOrderedPinnedIds : undefined,
          },
        },
      };
    }

    case 'updateSavedDialogPinned': {
      const { id, isPinned } = update;

      const { saved: orderedPinnedIds } = global.chats.orderedPinnedIds;

      let newOrderedPinnedIds = orderedPinnedIds || [];
      if (!isPinned) {
        newOrderedPinnedIds = newOrderedPinnedIds.filter((pinnedId) => pinnedId !== id);
      } else if (!newOrderedPinnedIds.includes(id)) {
        newOrderedPinnedIds = [id, ...newOrderedPinnedIds];
      }

      return {
        ...global,
        chats: {
          ...global.chats,
          orderedPinnedIds: {
            ...global.chats.orderedPinnedIds,
            saved: newOrderedPinnedIds.length ? newOrderedPinnedIds : undefined,
          },
        },
      };
    }

    case 'updateChatListType': {
      const { id, folderId } = update;

      return updateChatListType(global, id, folderId);
    }

    case 'updateChatFolder': {
      const { id, folder } = update;
      const { byId: chatFoldersById, orderedIds } = global.chatFolders;

      const isDeleted = folder === undefined;

      Object.values(global.byTabId).forEach(({ id: tabId }) => {
        const tabState = selectTabState(global, tabId);
        const isFolderActive = Object.values(chatFoldersById)[tabState.activeChatFolder - 1]?.id === id;

        if (isFolderActive) {
          global = updateTabState(global, { activeChatFolder: 0 }, tabId);
        }
      });

      const newChatFoldersById = !isDeleted ? { ...chatFoldersById, [id]: folder } : omit(chatFoldersById, [id]);
      const newOrderedIds = !isDeleted
        ? orderedIds?.includes(id) ? orderedIds : [...(orderedIds || []), id]
        : orderedIds?.filter((orderedId) => orderedId !== id);

      return {
        ...global,
        chatFolders: {
          ...global.chatFolders,
          byId: newChatFoldersById,
          orderedIds: newOrderedIds,
          invites: omit(global.chatFolders.invites, [id]),
        },
      };
    }

    case 'updateChatFoldersOrder': {
      const { orderedIds } = update;

      return {
        ...global,
        chatFolders: {
          ...global.chatFolders,
          orderedIds,
        },
      };
    }

    case 'updateRecommendedChatFolders': {
      const { folders } = update;

      return {
        ...global,
        chatFolders: {
          ...global.chatFolders,
          recommended: folders,
        },
      };
    }

    case 'updateChatMembers': {
      const targetChatFullInfo = selectChatFullInfo(global, update.id);
      const { replacedMembers, addedMember, deletedMemberId } = update;
      if (!targetChatFullInfo) {
        return undefined;
      }

      let shouldUpdate = false;
      let members = targetChatFullInfo?.members
        ? [...targetChatFullInfo.members]
        : [];

      if (replacedMembers) {
        members = replacedMembers;
        shouldUpdate = true;
      } else if (addedMember) {
        if (
          !members.length
          || !members.some((m) => m.userId === addedMember.userId)
        ) {
          members.push(addedMember);
          shouldUpdate = true;
        }
      } else if (members.length && deletedMemberId) {
        const deleteIndex = members.findIndex((m) => m.userId === deletedMemberId);
        if (deleteIndex > -1) {
          members.slice(deleteIndex, 1);
          shouldUpdate = true;
        }
      }

      if (shouldUpdate) {
        const adminMembers = members.filter(({ isOwner, isAdmin }) => isOwner || isAdmin);
        // TODO Kicked members?

        global = updateChat(global, update.id, { membersCount: members.length });
        global = updateChatFullInfo(global, update.id, {
          members,
          adminMembersById: buildCollectionByKey(adminMembers, 'userId'),
        });

        return global;
      }

      return undefined;
    }

    case 'draftMessage': {
      const {
        chatId, threadId, draft,
      } = update;
      const chat = global.chats.byId[chatId];
      if (!chat) {
        return undefined;
      }

      global = replaceThreadParam(global, chatId, threadId || MAIN_THREAD_ID, 'draft', draft);
      global = updateChat(global, chatId, { draftDate: draft?.date });
      return global;
    }

    case 'updatePendingJoinRequests': {
      const { chatId, requestsPending, recentRequesterIds } = update;
      const chat = global.chats.byId[chatId];
      if (!chat) {
        return undefined;
      }

      global = updateChatFullInfo(global, chatId, {
        requestsPending,
        recentRequesterIds,
      });
      setGlobal(global);

      actions.loadChatJoinRequests({ chatId });
      return undefined;
    }

    case 'updatePinnedTopic': {
      const { chatId, topicId, isPinned } = update;

      const chat = global.chats.byId[chatId];
      if (!chat) {
        return undefined;
      }

      global = updateTopic(global, chatId, topicId, {
        isPinned,
      });
      setGlobal(global);

      return undefined;
    }

    case 'updatePinnedTopicsOrder': {
      const { chatId, order } = update;

      const chat = global.chats.byId[chatId];
      if (!chat) return undefined;

      global = replacePinnedTopicIds(global, chatId, order);
      setGlobal(global);

      return undefined;
    }

    case 'updateTopic': {
      const { chatId, topicId } = update;

      const chat = selectChat(global, chatId);
      if (!chat?.isForum) return undefined;

      actions.loadTopicById({ chatId, topicId });

      return undefined;
    }

    case 'updateTopics': {
      const { chatId } = update;

      const chat = selectChat(global, chatId);
      if (!chat?.isForum) return undefined;

      actions.loadTopics({ chatId, force: true });

      return undefined;
    }

    case 'updateViewForumAsMessages': {
      const { chatId, isEnabled } = update;

      const chat = selectChat(global, chatId);
      if (!chat?.isForum) return undefined;

      global = updateChat(global, chatId, {
        isForumAsMessages: isEnabled,
      });
      setGlobal(global);
      break;
    }

    case 'updateNewProfilePhoto': {
      const { peerId, photo } = update;

      global = updateChat(global, peerId, {
        avatarPhotoId: photo.id,
      });
      setGlobal(global);

      actions.loadMoreProfilePhotos({ peerId, shouldInvalidateCache: true });

      break;
    }

    case 'updateDeleteProfilePhoto': {
      const { peerId, photoId } = update;

      const peer = selectPeer(global, peerId);
      if (!peer) {
        return undefined;
      }

      if (!photoId || peer.avatarPhotoId === photoId) {
        global = updateChat(global, peerId, {
          avatarPhotoId: undefined,
        });
        global = replacePeerPhotos(global, peerId, undefined);
      } else {
        global = deletePeerPhoto(global, peerId, photoId);
      }
      setGlobal(global);

      actions.loadMoreProfilePhotos({ peerId, shouldInvalidateCache: true });

      break;
    }
  }

  return undefined;
});
