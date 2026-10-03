import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

export type PositionTransferStatus =
  | 'PENDING' // 现场主管已发起，等待工人确认
  | 'CONFIRMED' // 工人确认，保险/工时/工资同步切换
  | 'REJECTED'; // 工人拒绝，进入到场补偿判定

// 到场补偿判定
export type ArrivalCompensationStatus =
  | 'PENDING' // 尚未判定
  | 'REQUIRED' // 企业仍需支付到场补偿
  | 'WAIVED'; // 企业无需支付

export type WageDiffType = 'UP' | 'DOWN' | 'SAME';

/**
 * 岗位临时调换确认单
 * 场景：工人报名「仓库分拣」到场后，企业要求改做「搬运重货」。
 * 必须由现场主管发起并书面说明新岗位的工作强度、风险与工资差异，
 * 经工人明确确认后保险范围与工时单才同步切换；
 * 工人拒绝则记录原因并由平台判定企业是否仍需支付到场补偿。
 */
@Entity('position_transfers')
@Index(['assignmentId'])
export class PositionTransfer {
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

  // 发起人（现场主管/企业账号）
  @Column()
  initiatedBy: number;

  @Column({ length: 64, nullable: true })
  initiatedByName: string | null;

  // 发起时间（服务器时间，不可篡改）
  @Column({ type: 'datetime' })
  initiatedAt: Date;

  // ---------- 原岗位快照（报名时约定，避免事后按原岗位规则浑水摸鱼） ----------
  @Column({ length: 128 })
  originalPosition: string;

  @Column({ type: 'varchar', length: 16 })
  originalIndustry: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  originalDailyWage: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  originalOvertimeRate: number;

  @Column({ type: 'int' })
  originalCoverageWan: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  originalPremium: number;

  @Column({ type: 'int', default: 1 })
  originalRiskLevel: number;

  // ---------- 新岗位（主管须说明强度、风险、工资差异） ----------
  @Column({ length: 128 })
  newPosition: string;

  @Column({ type: 'varchar', length: 16 })
  newIndustry: string;

  // 新工作强度说明（如「持续搬运 20~30kg 重货、负重爬车」）
  @Column({ type: 'text' })
  newWorkIntensity: string;

  // 新岗位风险说明（如「砸伤、腰肌劳损、车辆剐蹭」）
  @Column({ type: 'text' })
  newRiskDescription: string;

  @Column({ type: 'int', default: 1 })
  newRiskLevel: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  newDailyWage: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  newOvertimeRate: number;

  @Column({ type: 'int' })
  newCoverageWan: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  newPremium: number;

  // 工资差异方向与书面说明
  @Column({ type: 'varchar', length: 8, default: 'SAME' })
  wageDiffType: WageDiffType;

  @Column({ type: 'text', nullable: true })
  wageDiffNote: string | null;

  // 企业要求开始新岗位作业的时间（争议时段起点，默认=发起时间）
  @Column({ type: 'datetime' })
  newWorkStartedAt: Date;

  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status: PositionTransferStatus;

  // 同步生成的岗位调换作业事件（任务时间线/结算重算触发器）
  @Column({ type: 'int', nullable: true })
  jobEventId: number | null;

  // ---------- 工人响应 ----------
  @Column({ type: 'datetime', nullable: true })
  workerRespondedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  workerConfirmedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  workerRejectReason: string | null;

  // 未确认就开始作业的时段（newWorkStartedAt → workerConfirmedAt），确认时由系统按服务器时间固化
  @Column({ type: 'int', default: 0 })
  disputedMinutes: number;

  // ---------- 保险同步 ----------
  @Column({ type: 'boolean', default: false })
  policyUpdated: boolean;

  // ---------- 拒绝后的到场补偿判定 ----------
  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  arrivalCompensation: ArrivalCompensationStatus;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  arrivalCompensationAmount: number;

  @Column({ type: 'text', nullable: true })
  arrivalCompensationReason: string | null;

  // 主管事后登记：工人拒绝后是继续从事原岗位（true）还是离场（false）
  @Column({ type: 'boolean', nullable: true })
  workerContinuedOriginal: boolean | null;

  @Column({ type: 'int', nullable: true })
  compensationResolvedBy: number | null;

  @Column({ type: 'datetime', nullable: true })
  compensationResolvedAt: Date | null;

  // 补偿是否已计入日结/补偿结算单
  @Column({ type: 'boolean', default: false })
  compensationSettled: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
