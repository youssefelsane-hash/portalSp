import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { storageServiceProvider } from '../../common/storage/storage.provider';
import { AdminModule } from '../admin/admin.module';
import { User } from '../auth/entities/user.entity';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { TechnicianProfile } from '../technicians/entities/technician-profile.entity';
import { AdminChatController } from './admin-chat.controller';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { OrderChatThreadListener } from './order-chat-thread.listener';
import { OrderCompletedChatCloseListener } from './order-completed-chat-close.listener';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatThread } from './entities/chat-thread.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatThread, ChatMessage, CustomerProfile, TechnicianProfile, User]),
    JwtModule.register({}),
    AdminModule,
  ],
  controllers: [ChatController, AdminChatController],
  providers: [ChatService, ChatGateway, OrderChatThreadListener, OrderCompletedChatCloseListener, storageServiceProvider],
  exports: [ChatService],
})
export class ChatModule {}
