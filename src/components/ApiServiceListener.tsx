import { useEffect } from '../lib/teact/teact';
import { getActions, getGlobal, withGlobal } from '../global';

import { MAIN_THREAD_ID } from '../api/types';
import { ElectronEvent } from '../types/electron';

import { hasStoredSession } from '../util/sessions';

import useFlag from '../hooks/useFlag';

type StateProps = {
  currentUserId?: string;
};

type SendMessageParams = {
  chatId: string; // 可以是 ID 或 username (@开头)
  content: string;
};

function ApiServiceListener({ currentUserId }: StateProps) {
  const { sendMessage } = getActions();
  const [isFirstRender, markFirstRenderComplete] = useFlag(true);

  // Handle requests to send a message
  useEffect(() => {
    if (!window.electron) return undefined;

    // 通过 username 或 ID 查找聊天 ID
    const resolveChatId = async (chatIdOrUsername: string): Promise<string | undefined> => {
      // 如果是数字或带负号的数字，视为 chatId
      if (/^-?\d+$/.test(chatIdOrUsername)) {
        return chatIdOrUsername;
      }

      // 如果是 @username 格式，需要查找对应的 chatId
      if (chatIdOrUsername.startsWith('@')) {
        const username = chatIdOrUsername.substring(1).toLowerCase();
        // 先从当前全局状态中查找
        const global = getGlobal();

        // 1. 查找用户
        const usersByUsername = Object.values(global.users.byId).filter(
          (user) => user.usernames?.some((u) => u.username.toLowerCase() === username),
        );

        if (usersByUsername.length > 0) {
          return usersByUsername[0].id;
        }

        // 2. 查找群组/频道
        const chatsByUsername = Object.values(global.chats.byId).filter(
          (chat) => chat.usernames?.some((u) => u.username.toLowerCase() === username),
        );

        if (chatsByUsername.length > 0) {
          return chatsByUsername[0].id;
        }
      }

      return undefined;
    };

    // Handler for message sending requests from the API service
    const handleSendMessage = async (data: SendMessageParams) => {
      if (!currentUserId) {
        // User is not logged in, respond with error
        window.electron?.sendMessageResult({
          success: false,
          error: 'User not logged in',
        });
        return;
      }

      try {
        // 解析 chatId 或 username
        const resolvedChatId = await resolveChatId(data.chatId);

        if (!resolvedChatId) {
          throw new Error(`Cannot find chat with identifier: ${data.chatId}`);
        }

        // Send message using built-in actions
        sendMessage({
          messageList: {
            chatId: resolvedChatId,
            threadId: MAIN_THREAD_ID,
            type: 'thread',
          },
          text: data.content,
        });

        // Report success back to main process
        window.electron?.sendMessageResult({
          success: true,
        });
      } catch (error) {
        // Report failure back to main process
        window.electron?.sendMessageResult({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred',
        });
      }
    };

    // Register event listener
    const unsubscribe = window.electron.on(ElectronEvent.API_SEND_MESSAGE, handleSendMessage);

    return () => {
      unsubscribe();
    };
  }, [currentUserId, sendMessage]);

  // Report authentication state to the main process
  useEffect(() => {
    if (isFirstRender || !window.electron) return;

    const isLoggedIn = Boolean(currentUserId);
    try {
      window.electron.updateApiAuthState(isLoggedIn);
    } catch (err) {
      // 静默处理错误
    }
  }, [currentUserId, isFirstRender]);

  // Check initial authentication state
  useEffect(() => {
    if (!window.electron) return;

    // Initial auth check (in case the app is already logged in when this component mounts)
    const isLoggedIn = hasStoredSession();
    try {
      window.electron.updateApiAuthState(isLoggedIn);
    } catch (err) {
      // 静默处理错误
    }

    markFirstRenderComplete();
  }, [markFirstRenderComplete]);

  // This is a utility component with no UI
  return undefined;
}

export default withGlobal(
  (global): StateProps => ({
    currentUserId: global.currentUserId,
  }),
)(ApiServiceListener);
