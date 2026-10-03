import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Appeal, Assignment, Job, Enterprise, AttendanceEvent, JobEvent, ChatMessage,
  Settlement, InsurancePolicy, InjuryClaim, User, Review, PositionChangeRequest,
} from '../../entities';
import { AppealsService } from './appeals.service';
import { AppealsController } from './appeals.controller';
import { SettlementModule } from '../settlements/settlement.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Appeal, Assignment, Job, Enterprise, AttendanceEvent, JobEvent, ChatMessage,
      Settlement, InsurancePolicy, InjuryClaim, User, Review, PositionChangeRequest,
    ]),
    SettlementModule,
  ],
  providers: [AppealsService],
  controllers: [AppealsController],
  exports: [AppealsService],
})
export class AppealsModule {}
