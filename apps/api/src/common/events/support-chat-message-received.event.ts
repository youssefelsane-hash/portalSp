export const SUPPORT_CHAT_MESSAGE_RECEIVED_EVENT = 'chat.support_message_received';

export class SupportChatMessageReceivedEvent {
  constructor(
    public readonly threadId: string,
    public readonly customerFullName: string,
    public readonly messagePreview: string,
  ) {}
}
