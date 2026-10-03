import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

export type PositionChangeStatus =
  | 'PROPOSED' // 现场主管已发起，等待工人确认
  | 'CONFIRMED' // 工人确认接受，保险范围/工时单/工资同步更新
  | 'REJECTED'; // 工人拒绝，平台判定到场补偿

// 到场后临时岗位调换确认单：
// 主管发起（说明新工作强度/风险/工资差异）→ 工人确认或拒绝；
// 时间锚点全部取服务器时间，是工时单分段与争议工时判定的依据。
@Entity('position_change_requests')
@Index(['assignmentId'])
export class PositionChangeRequest {
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

  // ---------- 主管发起 ----------
  @Column({ type: 'int' })
  initiatedBy: number;

  // 发起时间（服务器时间，争议工时起点锚点）
  @Column({ type: 'datetime' })
  initiatedAt: Date;

  // 新岗位名称（如：重货搬运）
  @Column({ length: 128 })
  newPosition: string;

  // 新岗位行业（可与原岗位相同，如仓库分拣→重货搬运均属 WAREHOUSE）
  @Column({ type: 'varchar', length: 16, nullable: true })
  newIndustryKey: string | null;

  // 新工作强度等级 1-5
  @Column({ type: 'int' })
  intensityLevel: number;

  @Column({ type: 'text' })
  intensityNote: string;

  // 新岗位风险等级 1-5（含与原岗位的对比，工人确认前可见）
  @Column({ type: 'int' })
  newRiskLevel: number;

  @Column({ type: 'text' })
  riskNote: string;

  // 原岗位日结工资快照
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  originalDailyWage: number;

  // 新岗位日结工资
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  newDailyWage: number;

  // 工资差异（新-原，负数表示降薪）
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  wageDiff: number;

  // 确认后同步执行的新保险方案（后端按行业/风险计算，前端不可篡改）
  @Column({ length: 64 })
  newInsurerProduct: string;

  @Column({ type: 'int' })
  newCoverageWan: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  newPremium: number;

  @Column({ type: 'int' })
  originalCoverageWan: number;

  @Column({ type: 'int' })
  originalRiskLevel: number;

  // ---------- 工人响应 ----------
  @Column({ type: 'varchar', length: 16, default: 'PROPOSED' })
  status: PositionChangeStatus;

  @Column({ type: 'datetime', nullable: true })
  workerRespondedAt: Date | null;

  // 拒绝原因（拒绝时必填）/ 确认备注
  @Column({ type: 'text', nullable: true })
  workerResponseNote: string | null;

  // 关联的作业事件（POSITION_CHANGE）
  @Column({ type: 'int', nullable: true })
  jobEventId: number | null;

  // ---------- 拒绝后的到场补偿判定 ----------
  // 工人是否已实际到岗（四重校验通过）
  @Column({ type: 'boolean', default: false })
  workerArrived: boolean;

  // 平台判定企业是否仍需支付到场补偿
  @Column({ type: 'boolean', default: false })
  appearanceCompensationRequired: boolean;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  appearanceCompensationAmount: number;

  @Column({ type: 'text', nullable: true })
  appearanceCompensationNote: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
