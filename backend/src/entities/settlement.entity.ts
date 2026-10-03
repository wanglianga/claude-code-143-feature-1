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

  // ---------- 岗位临时调换 ----------
  // 工人确认岗位调换后，结算按新岗位规则（新岗位名称留痕）
  @Column({ length: 128, nullable: true })
  settledPosition: string | null;

  // 未确认就开始作业的争议时段（分钟）——不计入正常工资，单独列示待裁决
  @Column({ type: 'int', default: 0 })
  disputedMinutes: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  disputedDeduction: number;

  @Column({ type: 'text', nullable: true })
  disputedReason: string | null;

  // 工人拒绝岗位调换后企业仍需支付的到场补偿
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  arrivalCompensation: number;

  @Column({ type: 'int', nullable: true })
  positionTransferId: number | null;

  // ---- 金额明细 ----
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  baseWage: number; // 按有效工时折算的基础工资

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  overtimePay: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  extraCarryPay: number; // 已审批的额外搬运/突击任务补贴

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
