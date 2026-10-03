import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

export type SettlementStatus =
  | 'DRAFT' // 系统生成
  | 'CONFIRMED' // 企业确认
  | 'PAID' // 已日结发放
  | 'ADJUSTED'; // 经申诉调整后重新发放

@Entity('settlements')
@Index(['assignmentId'], { unique: true })
export class Settlement {
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

  // ---- 有效工时 ----
  @Column({ type: 'int', default: 0 })
  workMinutes: number; // 实际有效工时（分钟）

  @Column({ type: 'int', default: 0 })
  overtimeMinutes: number; // 已审批加班分钟

  @Column({ type: 'int', default: 0 })
  lateMinutes: number; // 迟到分钟（超出宽限期）

  // ---- 金额明细 ----
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  baseWage: number; // 按有效工时折算的基础工资

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  overtimePay: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  extraCarryPay: number; // 已审批的额外搬运/突击任务补贴

  // ---- 临时岗位调换分段工资 ----
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  oldPositionPay: number; // 原岗位时段工资

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  newPositionPay: number; // 工人确认调换后的新岗位时段工资

  // 未确认岗位调换即开始作业的时段（争议工时，暂按原岗位标准计发，可申诉）
  @Column({ type: 'int', default: 0 })
  disputedMinutes: number;

  @Column({ type: 'int', nullable: true })
  positionChangeId: number | null;

  // 工人拒绝临时调换且已实际到岗：企业仍须支付的到场补偿
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  appearanceCompensation: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  mealAllowance: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  lateDeduction: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  otherDeduction: number; // 早退/其他扣款

  @Column({ type: 'text', nullable: true })
  deductionReason: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  insurancePremium: number; // 企业承担保费（列示，不向工人扣）

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  platformServiceFee: number; // 平台服务费（企业侧）

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  enterprisePrepaymentUsed: number; // 动用企业预付款

  // 应发工人（= baseWage + overtimePay + meal - 迟到/其他扣款）
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  workerPayable: number;

  // 企业应付总额（工资 + 保费 + 服务费）
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  enterpriseCharged: number;

  @Column({ type: 'varchar', length: 16, default: 'DRAFT' })
  status: SettlementStatus;

  @Column({ type: 'datetime', nullable: true })
  paidAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
