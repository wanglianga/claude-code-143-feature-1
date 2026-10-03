import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  PositionTransfer, Assignment, Job, JobEvent, InsurancePolicy,
  Settlement, ChatMessage, Enterprise,
} from '../../entities';
import { PositionTransfersService } from './position-transfers.service';
import { PositionTransfersController } from './position-transfers.controller';
import { SettlementModule } from '../settlements/settlement.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PositionTransfer, Assignment, Job, JobEvent, InsurancePolicy,
      Settlement, ChatMessage, Enterprise,
    ]),
    SettlementModule,
  ],
  providers: [PositionTransfersService],
  controllers: [PositionTransfersController],
  exports: [PositionTransfersService],
})
export class PositionTransfersModule {}
