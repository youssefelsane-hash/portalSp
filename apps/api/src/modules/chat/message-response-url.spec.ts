import { ChatController } from './chat.controller';
import { toMessageResponseDto } from './dto/message-response.dto';
import { ChatMessage, ChatMessageType } from './entities/chat-message.entity';
import { StorageService } from '../../common/storage/storage.service';

describe('Chat image response URLs', () => {
  const imageMessage = (storageKey: string | null): ChatMessage => ({
    id: 'message-1',
    threadId: 'thread-1',
    senderUserId: 'user-1',
    messageType: ChatMessageType.IMAGE,
    content: null,
    fileUrl: 'https://r2.example/expired-url',
    storageKey,
    isRead: false,
    readAt: null,
    isFlagged: false,
    createdAt: new Date('2026-09-22T00:00:00Z'),
  });

  const storage = (freshUrl = 'https://r2.example/fresh-url'): StorageService => ({
    save: jest.fn(),
    delete: jest.fn(),
    getUrl: jest.fn().mockResolvedValue(freshUrl),
  });

  it('signs a fresh URL from storage_key instead of returning the stored presigned URL', async () => {
    const service = storage();
    const dto = await toMessageResponseDto(imageMessage('chat/thread-1/photo.jpg'), service);

    expect(dto.file_url).toBe('https://r2.example/fresh-url');
    expect(service.getUrl).toHaveBeenCalledWith('chat/thread-1/photo.jpg');
  });

  it('keeps legacy image rows readable when storage_key is absent', async () => {
    const service = storage();
    const dto = await toMessageResponseDto(imageMessage(null), service);

    expect(dto.file_url).toBe('https://r2.example/expired-url');
    expect(service.getUrl).not.toHaveBeenCalled();
  });

  it('broadcasts the freshly signed image URL to the chat WebSocket room', async () => {
    const service = storage('https://r2.example/fresh-websocket-url');
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const chatService = { sendImageMessage: jest.fn().mockResolvedValue(imageMessage('chat/thread-1/photo.jpg')) };
    const controller = new ChatController(chatService as never, { server: { to } } as never, service);

    const file = {
      // A valid PNG signature is enough for the controller-level signature guard.
      buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
      mimetype: 'image/png',
      originalname: 'photo.png',
      size: 24,
    } as Express.Multer.File;
    const dto = await controller.sendImageMessage({ sub: 'user-1' } as never, 'thread-1', file);

    expect(dto.file_url).toBe('https://r2.example/fresh-websocket-url');
    expect(to).toHaveBeenCalledWith('thread:thread-1');
    expect(emit).toHaveBeenCalledWith('chat:message_received', expect.objectContaining({ file_url: dto.file_url }));
  });
});
