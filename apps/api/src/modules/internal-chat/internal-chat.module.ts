import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { InternalChatThread } from './entities/internal-chat-thread.entity';
import { InternalMessage } from './entities/internal-message.entity';
import { InternalChatController } from './internal-chat.controller';
import { InternalChatService } from './internal-chat.service';

@Module({
  imports: [TypeOrmModule.forFeature([InternalChatThread, InternalMessage, User])],
  controllers: [InternalChatController],
  providers: [InternalChatService],
})
export class InternalChatModule {}
