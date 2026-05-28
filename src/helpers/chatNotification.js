const { getConversationDetail } = require("../services/chatService");
const pushNotification = require("./pushNotification");

function normalizeId(value) {
  return String(value ?? "").trim();
}

function resolveMemberId(member) {
  return normalizeId(member?._id || member);
}

function resolveAccountId(member) {
  const account = member?.id_account;

  if (!account) return "";

  return normalizeId(account?._id || account);
}

function getConversationMembers(conversation) {
  return Array.isArray(conversation?.members) ? conversation.members : [];
}

function buildNotificationContent({ conversation, senderName, message }) {
  const isGroupChat = conversation?.type === "group";
  const conversationName = conversation?.display_name || conversation?.name;
  const text = message?.content || "Tin nhắn mới";

  return {
    title: isGroupChat
      ? conversationName || "Nhóm chat"
      : senderName || conversationName || "Tin nhắn mới",
    body: isGroupChat ? `${senderName || "Có người"}: ${text}` : text,
  };
}

async function sendChatMessageNotification({
  conversationId,
  senderUserInfoId,
  senderName,
  message,
  conversation: providedConversation,
}) {
  if (!conversationId || !senderUserInfoId || !message) {
    return { successCount: 0, failureCount: 0, invalidTokens: [], tokens: [] };
  }

  try {
    const conversation =
      providedConversation ||
      (await getConversationDetail({
        conversationId,
        userInfoId: senderUserInfoId,
      }));

    const members = getConversationMembers(conversation);
    const recipientAccounts = members
      .filter(
        (member) => resolveMemberId(member) !== normalizeId(senderUserInfoId),
      )
      .map((member) => resolveAccountId(member))
      .filter(Boolean);

    if (!recipientAccounts.length) {
      return {
        successCount: 0,
        failureCount: 0,
        invalidTokens: [],
        tokens: [],
      };
    }

    const { title, body } = buildNotificationContent({
      conversation,
      senderName,
      message,
    });

    const data = {
      type: "chat_message",
      screen: "ChatRoomScreen",
      conversationId: String(conversationId),
      messageId: String(message?._id || message?.clientMessageId || ""),
      senderUserInfoId: String(senderUserInfoId),
    };

    const results = await Promise.all(
      recipientAccounts.map((accountId) =>
        pushNotification.sendToAccount({
          account_id: accountId,
          title,
          body,
          data,
        }),
      ),
    );

    return results.reduce(
      (accumulator, result) => ({
        successCount: accumulator.successCount + (result?.successCount || 0),
        failureCount: accumulator.failureCount + (result?.failureCount || 0),
        invalidTokens: [
          ...accumulator.invalidTokens,
          ...(result?.invalidTokens || []),
        ],
        tokens: [...accumulator.tokens, ...(result?.tokens || [])],
      }),
      { successCount: 0, failureCount: 0, invalidTokens: [], tokens: [] },
    );
  } catch (error) {
    console.error(
      "sendChatMessageNotification error:",
      error?.message || error,
    );
    return { successCount: 0, failureCount: 0, invalidTokens: [], tokens: [] };
  }
}

module.exports = {
  sendChatMessageNotification,
};
