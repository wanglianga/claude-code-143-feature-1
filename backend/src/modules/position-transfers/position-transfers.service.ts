import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  PositionTransfer, Assignment, Job, JobEvent, InsurancePolicy,
  Settlement, ChatMessage, Enterprise,
} from '../../entities';
import { INDUSTRIES } from '../../risk.constants';
import { round2, minutesBetween } from '../../geo';
import { SettlementService } from '../settlements/settlement.service';

export class InitiateTransferDto {
  assignmentId: number;
  newPosition: string;
  newIndustry: string; // IndustryKey
  newWorkIntensity: string;
  newRiskDescription: string;
  newDailyWage: number;
  newOvertimeRate?: number;
  newCoverageWan?: number;
  wageDiffNote?: string;
  newWorkStartedAt?: string; // 企业要求开始新岗位的时间（默认服务器当前时间）
}

// 到场补偿：原日薪比例与保底额（平台统一规则，避免企业事后按原岗位规则压价）
const COMPENSATION_RATE = 0.2;
const COMPENSATION_FLOOR = 50;

@Injectable()
export class PositionTransfersService {
  constructor(
    @InjectRepository(PositionTransfer) private transfers: Repository<PositionTransfer>,
    @InjectRepository(Assignment) private assignments: Repository<Assignment>,
    @InjectRepository(Job) private jobs: Repository<Job>,
    @InjectRepository(JobEvent) private jobEvents: Repository<JobEvent>,
    @InjectRepository(InsurancePolicy) private policies: Repository<InsurancePolicy>,
    @InjectRepository(Settlement) private settlements: Repository<Settlement>,
    @InjectRepository(ChatMessage) private messages: Repository<ChatMessage>,
    @InjectRepository(Enterprise) private enterprises: Repository<Enterprise>,
    private settlementService: SettlementService,
  ) {}

  // ===================== 现场主管发起岗位临时调换 =====================
  async initiate(user: { sub: number; role: string; name: string; enterpriseId?: number | null }, dto: InitiateTransferDto) {
    const assignment = await this.assignments.findOne({ where: { id: Number(dto.assignmentId) } });
    if (!assignment) throw new NotFoundException('派单不存在');
    const job = await this.jobs.findOne({ where: { id: assignment.jobId } });
    if (!job) throw new NotFoundException('岗位不存在');
    if (user.enterpriseId !== job.enterpriseId) throw new ForbiddenException('只能对本企业岗位发起调换');

    // 场景锚点：工人已到场（已到岗/作业中）才谈得上「到场后临时调换」
    if (!['CHECKED_IN', 'WORKING'].includes(assignment.status)) {
      throw new BadRequestException('工人尚未完成到岗校验，不能发起到场岗位调换');
    }

    const newPosition = (dto.newPosition || '').trim();
    const intensity = (dto.newWorkIntensity || '').trim();
    const riskDesc = (dto.newRiskDescription || '').trim();
    if (!newPosition) throw new BadRequestException('请填写调换后的新岗位名称');
    if (!intensity) throw new BadRequestException('请书面说明新岗位的工作强度');
    if (!riskDesc) throw new BadRequestException('请书面说明新岗位的风险点');
    const newDailyWage = Number(dto.newDailyWage);
    if (!(newDailyWage > 0)) throw new BadRequestException('新岗位日工资必须大于 0');

    const industry = INDUSTRIES[dto.newIndustry as keyof typeof INDUSTRIES];
    if (!industry) throw new BadRequestException('未知的新岗位行业类型');

    const pending = await this.transfers.findOne({ where: { assignmentId: assignment.id, status: 'PENDING' } });
    if (pending) throw new BadRequestException('已存在等待工人确认的岗位调换单，请先处理该单');

    const ent = await this.enterprises.findOne({ where: { id: job.enterpriseId } });
    const newRiskLevel = Math.min(5, industry.baseRiskLevel + Math.max(0, (ent?.riskLevel ?? 1) - 1));
    const newOvertimeRate = Number(dto.newOvertimeRate ?? job.overtimeRate);
    const newCoverageWan = Number(dto.newCoverageWan ?? Math.max(Number(job.insuranceCoverageWan), 30));
    // 新岗位保费按行业风险费率与新工资重算（与发单口径一致）
    const newPremium = Math.round(newDailyWage * industry.insuranceRate * 100) / 100;

    const wageDiff = round2(newDailyWage - Number(job.dailyWage));
    const wageDiffType = wageDiff > 0 ? 'UP' : wageDiff < 0 ? 'DOWN' : 'SAME';
    const autoWageNote = wageDiffType === 'UP'
      ? `新岗位日工资高于原岗位，差额 +¥${wageDiff.toFixed(2)}/班`
      : wageDiffType === 'DOWN'
        ? `新岗位日工资低于原岗位，差额 -¥${Math.abs(wageDiff).toFixed(2)}/班，需工人明确同意`
        : '新岗位日工资与原岗位持平';

    const now = new Date();
    const startedAt = dto.newWorkStartedAt ? new Date(dto.newWorkStartedAt) : now;
    if (startedAt > now) throw new BadRequestException('新岗位作业开始时间不能晚于当前时间');

    // 同步挂一条岗位调换作业事件：工人确认前保持 PENDING（不计工时/工资）
    const event = await this.jobEvents.save(this.jobEvents.create({
      assignmentId: assignment.id,
      jobId: job.id,
      workerId: assignment.workerId,
      type: 'POSITION_CHANGE',
      description: `现场主管发起岗位调换：${job.title} → ${newPosition}。工作强度：${intensity}。风险：${riskDesc}`,
      occurredAt: now,
      newPosition,
      status: 'PENDING',
    }));

    const transfer = await this.transfers.save(this.transfers.create({
      assignmentId: assignment.id,
      jobId: job.id,
      workerId: assignment.workerId,
      enterpriseId: job.enterpriseId,
      initiatedBy: user.sub,
      initiatedByName: user.name,
      initiatedAt: now,
      originalPosition: job.title,
      originalIndustry: job.industry,
      originalDailyWage: job.dailyWage,
      originalOvertimeRate: job.overtimeRate,
      originalCoverageWan: job.insuranceCoverageWan,
      originalPremium: job.insurancePremium,
      originalRiskLevel: INDUSTRIES[job.industry]?.baseRiskLevel ?? 1,
      newPosition,
      newIndustry: dto.newIndustry,
      newWorkIntensity: intensity,
      newRiskDescription: riskDesc,
      newRiskLevel,
      newDailyWage,
      newOvertimeRate,
      newCoverageWan,
      newPremium,
      wageDiffType,
      wageDiffNote: dto.wageDiffNote?.trim() ? `${autoWageNote}；${dto.wageDiffNote.trim()}` : autoWageNote,
      newWorkStartedAt: startedAt,
      status: 'PENDING',
      jobEventId: event.id,
      arrivalCompensation: 'PENDING',
    }));

    await this.postSystemMessage(
      assignment.id,
      `现场主管发起岗位临时调换：${job.title} → ${newPosition}，已书面说明工作强度、风险与工资差异（${autoWageNote}），等待工人确认。工人确认前保险范围与工时仍按原岗位执行。`,
    );

    return { transfer, message: '岗位调换单已发起，等待工人在任务室确认' };
  }

  // ===================== 工人确认：保险范围 + 工时单同步切换 =====================
  async confirm(workerId: number, transferId: number) {
    const t = await this.getOwnedPending(transferId, workerId);
    const now = new Date();

    t.status = 'CONFIRMED';
    t.workerRespondedAt = now;
    t.workerConfirmedAt = now;
    // 未确认就开始作业的时段 → 争议工时（按服务器时间固化，不可改）
    t.disputedMinutes = Math.max(0, minutesBetween(t.newWorkStartedAt, now));

    // 作业事件转为已确认（批准留痕），触发后续结算按新岗位规则
    if (t.jobEventId) {
      const ev = await this.jobEvents.findOne({ where: { id: t.jobEventId } });
      if (ev && ev.status === 'PENDING') {
        ev.status = 'APPROVED';
        ev.reviewedBy = workerId;
        ev.reviewedAt = now;
        ev.reviewNote = `工人于 ${now.toLocaleString('zh-CN')} 确认岗位调换`;
        await this.jobEvents.save(ev);
      }
    }

    // 保险范围同步：保额/保费/承保岗位自确认时刻起切换；到岗生效时间这一事实不变
    const policy = await this.policies.findOne({ where: { assignmentId: t.assignmentId } });
    if (policy) {
      if (policy.originalPosition === null) {
        policy.originalPosition = policy.currentPosition ?? t.originalPosition;
        policy.originalCoverageWan = policy.coverageWan;
        policy.originalPremium = policy.premium;
      }
      policy.currentPosition = t.newPosition;
      policy.coverageWan = t.newCoverageWan;
      policy.premium = t.newPremium;
      policy.jobRiskLevel = t.newRiskLevel;
      policy.positionTransferId = t.id;
      await this.policies.save(policy);
      t.policyUpdated = true;
    }
    await this.transfers.save(t);

    // 已生成的工时/结算单立即按新岗位规则 + 争议时段重算；
    // 尚未签退也生成一份预估单，保证工人端确认后立即可见新工资
    let settlement: Settlement | null = await this.settlements.findOne({ where: { assignmentId: t.assignmentId } });
    if (settlement && settlement.status !== 'PAID' && settlement.status !== 'ADJUSTED') {
      settlement = await this.settlementService.generate(t.assignmentId);
    } else if (!settlement) {
      settlement = await this.settlementService.generate(t.assignmentId);
    }

    await this.postSystemMessage(
      t.assignmentId,
      `工人已确认岗位调换为「${t.newPosition}」：保险保额 ${t.newCoverageWan} 万元、岗位风险 L${t.newRiskLevel}、日工资 ¥${t.newDailyWage} 已同步生效` +
      (t.disputedMinutes > 0 ? `；确认前已作业 ${t.disputedMinutes} 分钟标记为争议工时，暂不计入正常工资。` : '。'),
    );

    return {
      transfer: t, policy: policy || null, settlement,
      message: `已确认新岗位「${t.newPosition}」，保险范围与工时单已同步更新` +
        (t.disputedMinutes > 0 ? `；确认前 ${t.disputedMinutes} 分钟列为争议工时` : ''),
    };
  }

  // ===================== 工人拒绝：记录原因 + 平台判定到场补偿 =====================
  async reject(workerId: number, transferId: number, reason: string) {
    const t = await this.getOwnedPending(transferId, workerId);
    if (!reason?.trim()) throw new BadRequestException('请填写拒绝岗位调换的原因');
    const now = new Date();

    t.status = 'REJECTED';
    t.workerRespondedAt = now;
    t.workerRejectReason = reason.trim();

    if (t.jobEventId) {
      const ev = await this.jobEvents.findOne({ where: { id: t.jobEventId } });
      if (ev && ev.status === 'PENDING') {
        ev.status = 'REJECTED';
        ev.reviewedBy = workerId;
        ev.reviewedAt = now;
        ev.reviewNote = `工人拒绝岗位调换：${reason.trim()}`;
        await this.jobEvents.save(ev);
      }
    }

    // 平台判定到场补偿：
    // 能发起调换说明工人已完成四重到岗校验、确已到场；企业单方面变更约定岗位，
    // 工人拒绝新岗位时企业仍应承担到场信赖成本（默认需支付到场补偿）。
    // 若工人随后留下继续从事原岗位并正常完工，主管可登记后改为无需补偿。
    const amount = round2(Math.max(COMPENSATION_FLOOR, Number(t.originalDailyWage) * COMPENSATION_RATE));
    t.arrivalCompensation = 'REQUIRED';
    t.arrivalCompensationAmount = amount;
    t.arrivalCompensationReason =
      `工人按原岗位「${t.originalPosition}」到场后，企业要求改做「${t.newPosition}」（${t.wageDiffNote || '工资有差异'}），工人拒绝：${reason.trim()}。` +
      `按平台规则企业需支付到场补偿 ¥${amount}（原日薪 ¥${t.originalDailyWage} 的 20%，保底 ¥${COMPENSATION_FLOOR}），不得再以原岗位规则要求工人从事新岗位或据此扣款；` +
      `如工人留下继续从事原岗位并正常完工，现场主管可登记后改为无需补偿。`;
    await this.transfers.save(t);

    // 工人可能直接离场（不再签退），仍需有一张可发放的到场补偿单
    const settlement = await this.settlementService.upsertArrivalCompensation(
      t.assignmentId, t.id, amount, t.arrivalCompensationReason,
    );

    await this.postSystemMessage(
      t.assignmentId,
      `工人拒绝岗位调换（原因：${reason.trim()}）。平台判定：企业需支付到场补偿 ¥${amount}，已计入任务结算，避免按原岗位规则错误结算。`,
    );

    return {
      transfer: t, settlement,
      message: `已记录拒绝原因，平台判定企业需支付到场补偿 ¥${amount}（如工人继续从事原岗位，主管可登记改判）`,
    };
  }

  /** 现场主管登记：工人拒绝后是否留下继续从事原岗位（用于到场补偿复核改判） */
  async resolveCompensation(
    user: { sub: number; role: string; enterpriseId?: number | null },
    transferId: number, continued: boolean, note?: string,
  ) {
    const t = await this.transfers.findOne({ where: { id: transferId } });
    if (!t) throw new NotFoundException('岗位调换单不存在');
    if (user.enterpriseId !== t.enterpriseId) throw new ForbiddenException('只能处理本企业的调换单');
    if (t.status !== 'REJECTED') throw new BadRequestException('仅工人拒绝的调换单需要判定到场补偿');

    t.workerContinuedOriginal = !!continued;
    t.compensationResolvedBy = user.sub;
    t.compensationResolvedAt = new Date();

    if (continued) {
      t.arrivalCompensation = 'WAIVED';
      t.arrivalCompensationReason =
        `${t.arrivalCompensationReason || ''}\n主管复核改判：工人拒绝新岗位后留下继续从事原岗位并正常出勤（${note || '无备注'}），企业已按原岗位提供劳动条件，无需另行支付到场补偿。`.trim();
      await this.transfers.save(t);
      // 若补偿单尚未发放，撤回补偿金额；工人按原岗位正常完工计酬
      await this.settlementService.upsertArrivalCompensation(t.assignmentId, t.id, 0, t.arrivalCompensationReason);
    } else {
      t.arrivalCompensation = 'REQUIRED';
      t.arrivalCompensationReason =
        `${t.arrivalCompensationReason || ''}\n主管复核确认：工人拒绝新岗位后已离场，未从事原岗位劳动（${note || '无备注'}），到场补偿维持应付。`.trim();
      await this.transfers.save(t);
      await this.settlementService.upsertArrivalCompensation(
        t.assignmentId, t.id, Number(t.arrivalCompensationAmount), t.arrivalCompensationReason,
      );
    }

    const settlement = await this.settlements.findOne({ where: { assignmentId: t.assignmentId } });
    return { transfer: t, settlement, message: continued ? '已改判：工人继续原岗位，无需到场补偿' : '已确认：工人离场，企业需支付到场补偿' };
  }

  // ===================== 查询 =====================
  async listByAssignment(assignmentId: number) {
    return this.transfers.find({ where: { assignmentId }, order: { id: 'DESC' } });
  }

  /** 工人端：待我确认的岗位调换 */
  async pendingForWorker(workerId: number) {
    return this.transfers.find({ where: { workerId, status: 'PENDING' }, order: { id: 'DESC' } });
  }

  /** 主管/企业现场工作台：本企业待处理调换单（含待工人确认、待补偿复核） */
  async boardForEnterprise(enterpriseId: number) {
    const all = await this.transfers.find({ where: { enterpriseId }, order: { id: 'DESC' }, take: 100 });
    return all;
  }

  // ===================== 内部 =====================
  private async getOwnedPending(transferId: number, workerId: number): Promise<PositionTransfer> {
    const t = await this.transfers.findOne({ where: { id: transferId } });
    if (!t) throw new NotFoundException('岗位调换单不存在');
    if (t.workerId !== workerId) throw new ForbiddenException('只能由当事工人本人确认/拒绝');
    if (t.status !== 'PENDING') throw new BadRequestException('该岗位调换单已处理，不能重复操作');
    return t;
  }

  private async postSystemMessage(assignmentId: number, content: string) {
    await this.messages.save(this.messages.create({
      assignmentId, senderId: 0, senderName: '平台系统', senderRole: 'SYSTEM', content,
    }));
  }
}
