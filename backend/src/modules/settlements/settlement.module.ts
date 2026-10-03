import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Settlement, Job, Assignment, AttendanceEvent, JobEvent, InsurancePolicy,
  Enterprise, Appeal, User, PositionChangeRequest,
} from '../../entities';
import { SettlementService } from './settlement.service';
import { SettlementController } from './settlement.controller';

@Module({
  imports: [TypeOrmModule.forFeature([
    Settlement, Job, Assignment, AttendanceEvent, JobEvent, InsurancePolicy,
    Enterprise, Appeal, User, PositionChangeRequest,
  ])],
  providers: [SettlementService],
  controllers: [SettlementController],
  exports: [SettlementService],
})
export class SettlementModule {}
