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

  // ---------- 岗位临时调换后的保险范围同步 ----------
  // 确认岗位调换后，承保岗位由原岗位切换为新岗位（保留原岗位快照便于审计）
  @Column({ length: 128, nullable: true })
  originalPosition: string | null;

  @Column({ length: 128, nullable: true })
  currentPosition: string | null;

  // 调换前保额/保费/风险快照
  @Column({ type: 'int', nullable: true })
  originalCoverageWan: number | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  originalPremium: number | null;

  // 触发保险范围变更的岗位调换确认单
  @Column({ type: 'int', nullable: true })
  positionTransferId: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
