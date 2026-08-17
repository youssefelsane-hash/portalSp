import { Module } from '@nestjs/common';
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
import { Order } from '../orders/entities/order.entity';
import { OrderChatRecoveryService } from './order-chat-recovery.service';
import { RealtimeSecurityModule } from '../../common/websocket/realtime-security.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatThread, ChatMessage, CustomerProfile, TechnicianProfile, User, Order]),
    AdminModule,
    RealtimeSecurityModule,
  ],
  controllers: [ChatController, AdminChatController],
  providers: [
    ChatService,
    ChatGateway,
    OrderChatThreadListener,
    OrderCompletedChatCloseListener,
    OrderChatRecoveryService,
    storageServiceProvider,
  ],
  exports: [ChatService],
})
export class ChatModule {}
