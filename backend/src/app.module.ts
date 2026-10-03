import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config } from './config';
import {
  User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
  JobEvent, InjuryClaim, ChatMessage, Settlement, Appeal, Review, PositionTransfer,
} from './entities';
import { AuthModule } from './modules/auth/auth.module';
import { RiskModule } from './modules/risk/risk.module';
import { EnterpriseModule } from './modules/enterprise/enterprise.module';
import { SettlementModule } from './modules/settlements/settlement.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { AppealsModule } from './modules/appeals/appeals.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PositionTransfersModule } from './modules/position-transfers/position-transfers.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: config.db.host,
      port: config.db.port,
      username: config.db.username,
      password: config.db.password,
      database: config.db.database,
      entities: [
        User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
        JobEvent, InjuryClaim, ChatMessage, Settlement, Appeal, Review, PositionTransfer,
      ],
      synchronize: true,
      charset: 'utf8mb4',
      timezone: '+08:00',
      retryAttempts: 20,
      retryDelay: 3000,
    }),
    RiskModule,
    EnterpriseModule,
    AuthModule,
    SettlementModule,
    TasksModule,
    JobsModule,
    AppealsModule,
    ReviewsModule,
    DashboardModule,
    PositionTransfersModule,
  ],
})
export class AppModule {}
