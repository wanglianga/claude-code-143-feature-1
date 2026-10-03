import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
  JobEvent, InjuryClaim, ChatMessage, Settlement, PositionTransfer,
} from '../../entities';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { SettlementModule } from '../settlements/settlement.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
      JobEvent, InjuryClaim, ChatMessage, Settlement, PositionTransfer,
    ]),
    SettlementModule,
  ],
  providers: [TasksService],
  controllers: [TasksController],
  exports: [TasksService],
})
export class TasksModule {}
