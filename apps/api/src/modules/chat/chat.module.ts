import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { OrderChatThreadListener } from './order-chat-thread.listener';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatThread } from './entities/chat-thread.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatThread, ChatMessage, CustomerProfile, TechnicianProfile]),
    JwtModule.register({}),
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatGateway, OrderChatThreadListener],
  exports: [ChatService],
})
export class ChatModule {}
