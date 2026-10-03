import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

export type InsuranceStatus =
  | 'PENDING' // 已录取待生效
  | 'ACTIVE' // 已生效（实际到岗+主管确认+岗位风险校验通过）
  | 'EXPIRED' // 任务结束
  | 'VOID'; // 岗位取消/未到岗

@Entity('insurance_policies')
@Index(['assignmentId'], { unique: true })
export class InsurancePolicy {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  assignmentId: number;

  @Column()
  jobId: number;

  @Column()
  workerId: number;

  @Column()
  enterpriseId: number;

  @Column({ length: 64 })
  insurerProduct: string;

  @Column({ type: 'int' })
  coverageWan: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  premium: number;

  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status: InsuranceStatus;

  // 生效时间必须 = 实际到岗（四重校验通过）且主管确认完成之后，由系统自动写入
  @Column({ type: 'datetime', nullable: true })
  effectiveFrom: Date | null;

  @Column({ type: 'datetime', nullable: true })
  effectiveTo: Date | null;

  // 触发生效的签到事件（审计链路）
  @Column({ type: 'int', nullable: true })
  activatedByAttendanceId: number | null;

  // 岗位风险等级快照（保险费率与风险相关）
  @Column({ type: 'int', default: 1 })
  jobRiskLevel: number;

  // 企业确认标记（保险生效与企业确认有关）
  @Column({ type: 'boolean', default: false })
  enterpriseConfirmed: boolean;

  // 临时岗位调换确认后同步更新保险范围（原方案留痕，禁止以原岗位范围结算新岗位风险）
  @Column({ type: 'int', nullable: true })
  adjustedByPositionChangeId: number | null;

  @Column({ type: 'datetime', nullable: true })
  adjustedAt: Date | null;

  // 历次调整的人类可读留痕（产品/保额/保费/风险等级）
  @Column({ type: 'text', nullable: true })
  adjustmentLog: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
