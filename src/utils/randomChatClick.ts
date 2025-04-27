import { getActions } from '../global';

export function randomChatClick(orderedIds: string[]) {
  if (!orderedIds || orderedIds.length === 0) {
    return;
  }

  // 随机选择一个聊天ID
  const randomIndex = Math.floor(Math.random() * orderedIds.length);
  const randomChatId = orderedIds[randomIndex];

  // 打开选中的聊天
  const { openChat } = getActions();
  openChat({ id: randomChatId, shouldReplaceHistory: true });
} 