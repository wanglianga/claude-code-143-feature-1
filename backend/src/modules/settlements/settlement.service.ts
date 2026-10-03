import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import {
  Settlement, Job, Assignment, AttendanceEvent, JobEvent, InsurancePolicy,
  Enterprise, Appeal, User, PositionTransfer,
} from '../../entities';
import { round2, minutesBetween } from '../../geo';

const EXTRA_CARRY_FLAT = 30; // 每次已审批的额外搬运突击补贴（元）

@Injectable()
export class SettlementService {
  constructor(
    @InjectRepository(Settlement) private settlements: Repository<Settlement>,
    @InjectRepository(Job) private jobs: Repository<Job>,
    @InjectRepository(Assignment) private assignments: Repository<Assignment>,
    @InjectRepository(AttendanceEvent) private attendance: Repository<AttendanceEvent>,
    @InjectRepository(JobEvent) private jobEvents: Repository<JobEvent>,
    @InjectRepository(InsurancePolicy) private policies: Repository<InsurancePolicy>,
    @InjectRepository(Enterprise) private enterprises: Repository<Enterprise>,
    @InjectRepository(Appeal) private appeals: Repository<Appeal>,
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(PositionTransfer) private transfers: Repository<PositionTransfer>,
    @InjectDataSource() private ds: DataSource,
  ) {}

  /** 根据有效工时、加班、迟到、餐补、扣款、预付款、服务费生成/重算日结明细（幂等） */
  async generate(assignmentId: number): Promise<Settlement> {
    const assignment = await this.assignments.findOne({ where: { id: assignmentId } });
    if (!assignment) throw new BadRequestException('派单不存在');
    const job = await this.jobs.findOne({ where: { id: assignment.jobId } });
    if (!job) throw new BadRequestException('岗位不存在');

    const checkIn = await this.attendance.findOne({
      where: { assignmentId, kind: 'CHECK_IN', allPassed: true },
      order: { eventTime: 'ASC' },
    });
    const checkOut = await this.attendance.findOne({
      where: { assignmentId, kind: 'CHECK_OUT', allPassed: true },
      order: { eventTime: 'DESC' },
    });
    if (!checkIn) throw new BadRequestException('尚无有效到岗签到记录，无法结算');

    const scheduledStart = new Date(job.startTime);
    const scheduledEnd = new Date(job.endTime);
    const scheduledMinutes = Math.max(1, minutesBetween(scheduledStart, scheduledEnd));

    // 岗位临时调换：取本任务最近一次已确认 / 已拒绝的调换单
    const confirmedTransfer = await this.transfers.findOne({
      where: { assignmentId, status: 'CONFIRMED' }, order: { id: 'DESC' },
    });
    const rejectedTransfer = await this.transfers.findOne({
      where: { assignmentId, status: 'REJECTED' }, order: { id: 'DESC' },
    });
    const leftAfterReject = !!rejectedTransfer && rejectedTransfer.workerContinuedOriginal !== true
      && rejectedTransfer.arrivalCompensation === 'REQUIRED';

    // 迟到分钟（超出宽限期）
    let lateMinutes = 0;
    const arrival = new Date(checkIn.eventTime);
    if (arrival.getTime() > scheduledStart.getTime()) {
      lateMinutes = Math.max(0, minutesBetween(scheduledStart, arrival) - (job.lateGraceMinutes || 0));
    }

    // 有效工时（日结口径）：
    // 约定班次工资对应 scheduledMinutes；迟到不减少工时（走迟到扣款）；
    // 经批准的早退按分钟折算；实际打卡时长仅作证据留存。
    const events = await this.jobEvents.find({ where: { assignmentId, status: 'APPROVED' } });
    const earlyLeaveEvent = events.find((e) => e.type === 'EARLY_LEAVE');
    const earlyLeaveMinutes = earlyLeaveEvent?.minutes || 0;
    const clockMinutes = checkOut ? Math.max(0, minutesBetween(checkIn.eventTime, checkOut.eventTime)) : 0;
    let workMinutes: number;
    if (checkOut) {
      workMinutes = Math.max(0, scheduledMinutes - earlyLeaveMinutes);
    } else if (leftAfterReject && rejectedTransfer!.workerRespondedAt) {
      // 工人拒绝新岗位后离场（未签退）：有效工时只计到拒绝时刻，另付到场补偿，不按全班结算
      workMinutes = Math.min(
        scheduledMinutes,
        Math.max(0, minutesBetween(scheduledStart, rejectedTransfer!.workerRespondedAt)),
      );
    } else if (rejectedTransfer && rejectedTransfer.workerContinuedOriginal === true && rejectedTransfer.compensationResolvedAt) {
      // 拒绝后留下继续原岗位、尚未签退：预估工时只计到主管复核时刻
      workMinutes = Math.min(
        scheduledMinutes,
        Math.max(0, minutesBetween(scheduledStart, rejectedTransfer.compensationResolvedAt)),
      );
    } else if (confirmedTransfer?.workerConfirmedAt) {
      // 已确认调换但仍在作业（未签退）：出一份截至确认时刻的预估单，工人端可立即看到新工资
      workMinutes = Math.min(
        scheduledMinutes,
        Math.max(0, minutesBetween(scheduledStart, confirmedTransfer.workerConfirmedAt)),
      );
    } else {
      workMinutes = scheduledMinutes;
    }
    void clockMinutes;

    // 已审批事件
    const overtimeEvents = events.filter((e) => e.type === 'OVERTIME');
    const overtimeMinutes = overtimeEvents.reduce((s, e) => s + (e.minutes || 0), 0);
    const extraCarryCount = events.filter((e) => e.type === 'EXTRA_CARRY').length;
    const extraCarryMinutes = events
      .filter((e) => e.type === 'EXTRA_CARRY')
      .reduce((s, e) => s + (e.minutes || 0), 0);

    // ---------- 基础工资：岗位调换确认后按时段分段计酬（不能再用原岗位规则统算） ----------
    let baseWage: number;
    let settledPosition: string | null = null;
    let disputedMinutes = 0;
    let disputedDeduction = 0;
    let disputedReason: string | null = null;

    if (confirmedTransfer) {
      settledPosition = confirmedTransfer.newPosition;
      const rateOrig = Number(confirmedTransfer.originalDailyWage) / scheduledMinutes;
      const rateNew = Number(confirmedTransfer.newDailyWage) / scheduledMinutes;
      // 原岗位段：班次开始 → 企业要求开始新岗位；争议段：要求开始 → 工人确认；新岗位段：确认之后
      let origMin = Math.max(0, minutesBetween(scheduledStart, confirmedTransfer.newWorkStartedAt));
      origMin = Math.min(origMin, workMinutes);
      let disputedMin = confirmedTransfer.disputedMinutes;
      disputedMin = Math.max(0, Math.min(disputedMin, workMinutes - origMin));
      const newMin = Math.max(0, workMinutes - origMin - disputedMin);
      baseWage = round2(origMin * rateOrig + newMin * rateNew);
      disputedMinutes = disputedMin;
      // 未确认已作业时段：该段实际从事新岗位，按新岗位费率暂扣，待申诉/仲裁裁决，不并入正常应发
      disputedDeduction = round2(disputedMin * rateNew);
      if (disputedMin > 0) {
        disputedReason =
          `企业要求自 ${new Date(confirmedTransfer.newWorkStartedAt).toLocaleString('zh-CN')} 起改做「${confirmedTransfer.newPosition}」，` +
          `工人于 ${new Date(confirmedTransfer.workerConfirmedAt!).toLocaleString('zh-CN')} 才确认，中间 ${disputedMin} 分钟未经确认即作业，` +
          `标记为争议工时，对应 ¥${disputedDeduction} 暂未计入工资，需经申诉/仲裁裁决，不得直接按原岗位规则结算。`;
      }
    } else {
      baseWage = round2((Number(job.dailyWage) * workMinutes) / scheduledMinutes);
    }

    // 加班费：岗位调换确认后的加班按新岗位加班费率，确认前按原费率
    const overtimePay = round2(overtimeEvents.reduce((sum, e) => {
      const afterConfirm = confirmedTransfer?.workerConfirmedAt &&
        new Date(e.occurredAt) >= new Date(confirmedTransfer.workerConfirmedAt);
      const rate = afterConfirm
        ? Number(confirmedTransfer!.newOvertimeRate)
        : Number(confirmedTransfer ? confirmedTransfer.originalOvertimeRate : job.overtimeRate);
      return sum + (e.minutes || 0) * (rate / 60);
    }, 0));

    const extraCarryPay = round2(
      extraCarryCount * EXTRA_CARRY_FLAT + extraCarryMinutes * (Number(job.overtimeRate) / 60) * 1.5,
    );
    const mealAllowance = workMinutes >= scheduledMinutes / 2 ? Number(job.mealAllowance) : 0;
    const lateDeduction = round2(Math.min(baseWage, lateMinutes * Number(job.lateDeductPerMin)));
    const otherDeduction = 0;
    const deductionReason = [
      lateMinutes > 0 ? `迟到 ${lateMinutes} 分钟扣款` : null,
      earlyLeaveEvent ? `早退 ${earlyLeaveEvent.minutes || 0} 分钟（已按实际工时折算）` : null,
      disputedReason,
    ].filter(Boolean).join('；') || null;

    // 拒绝岗位调换后的到场补偿（平台判定企业仍需支付，避免按原岗位规则错误结算）
    const arrivalCompensation = leftAfterReject ? Number(rejectedTransfer!.arrivalCompensationAmount) || 0 : 0;
    const positionTransferId = confirmedTransfer?.id ?? rejectedTransfer?.id ?? null;

    const workerPayable = round2(
      baseWage + overtimePay + extraCarryPay + mealAllowance + arrivalCompensation - lateDeduction - otherDeduction,
    );

    const policy = await this.policies.findOne({ where: { assignmentId } });
    const insurancePremium = policy && policy.status !== 'VOID' ? Number(policy.premium) : 0;
    const platformServiceFee = round2(baseWage * Number(job.platformFeeRate));
    const enterpriseCharged = round2(workerPayable + insurancePremium + platformServiceFee);

    // 企业预付款按当日实际到岗人数平摊到本单
    const checkedInCount = await this.assignments.count({
      where: { jobId: job.id, status: In(['CHECKED_IN', 'WORKING', 'COMPLETED']) },
    });
    const perHeadPrepay = checkedInCount > 0 ? Number(job.prepayment) / checkedInCount : 0;
    const prepaymentUsed = round2(Math.min(perHeadPrepay, enterpriseCharged));

    let settlement = await this.settlements.findOne({ where: { assignmentId } });
    if (!settlement) {
      settlement = this.settlements.create({ assignmentId, jobId: job.id, workerId: assignment.workerId, enterpriseId: job.enterpriseId });
    }
    Object.assign(settlement, {
      workMinutes,
      overtimeMinutes,
      lateMinutes,
      settledPosition,
      disputedMinutes,
      disputedDeduction,
      disputedReason,
      arrivalCompensation,
      positionTransferId,
      baseWage,
      overtimePay,
      extraCarryPay,
      mealAllowance,
      lateDeduction,
      otherDeduction,
      deductionReason,
      insurancePremium,
      platformServiceFee,
      enterprisePrepaymentUsed: prepaymentUsed,
      workerPayable,
      enterpriseCharged,
      status: settlement.status === 'PAID' || settlement.status === 'ADJUSTED' ? settlement.status : 'DRAFT',
    });
    return this.settlements.save(settlement);
  }

  /** 工人拒绝岗位调换后，登记/刷新到场补偿单（工人可能已离场、不再签退） */
  async upsertArrivalCompensation(assignmentId: number, transferId: number, amount: number, reason: string): Promise<Settlement> {
    const assignment = await this.assignments.findOne({ where: { id: assignmentId } });
    if (!assignment) throw new BadRequestException('派单不存在');
    const checkIn = await this.attendance.findOne({
      where: { assignmentId, kind: 'CHECK_IN', allPassed: true }, order: { eventTime: 'ASC' },
    });
    if (!checkIn) throw new BadRequestException('工人尚无有效到岗记录，无法计算到场补偿');

    let settlement = await this.settlements.findOne({ where: { assignmentId } });
    if (settlement && (settlement.status === 'PAID' || settlement.status === 'ADJUSTED')) {
      // 已发放/已裁决的单据不被覆盖，只在备注中留痕
      settlement.deductionReason = settlement.deductionReason
        ? `${settlement.deductionReason}；到场补偿复核：${reason}`
        : `到场补偿复核：${reason}`;
      settlement.positionTransferId = transferId;
      return this.settlements.save(settlement);
    }
    // 统一走分段计酬引擎（其内部读取调换单上的到场补偿判定）
    settlement = await this.generate(assignmentId);
    settlement.positionTransferId = transferId;
    if (!settlement.disputedReason) settlement.disputedReason = reason;
    else if (!settlement.disputedReason.includes('到场补偿')) settlement.disputedReason += `；${reason}`;
    return this.settlements.save(settlement);
  }

  /** 企业确认并发放日结（支持批量，按岗位） */
  async confirmAndPay(assignmentIds: number[], enterpriseId: number) {
    const list = await this.settlements.find({ where: { assignmentId: In(assignmentIds) } });
    const paid: Settlement[] = [];
    for (const s of list) {
      if (s.enterpriseId !== enterpriseId) throw new BadRequestException('不能结算其他企业的任务');
      if (s.status === 'PAID') { paid.push(s); continue; }
      s.status = 'PAID';
      s.paidAt = new Date();
      paid.push(await this.settlements.save(s));
    }
    return paid;
  }

  /** 客服/仲裁补发：在原应发上增加补发金额，保留审计痕迹 */
  async applyReissue(appeal: Appeal, amount: number, note: string): Promise<Settlement> {
    const s = await this.settlements.findOne({ where: { assignmentId: appeal.assignmentId } });
    if (!s) throw new BadRequestException('结算单不存在');
    s.workerPayable = round2(Number(s.workerPayable) + amount);
    s.enterpriseCharged = round2(Number(s.enterpriseCharged) + amount);
    s.otherDeduction = Number(s.otherDeduction); // 保留
    s.status = 'ADJUSTED';
    s.paidAt = new Date();
    s.deductionReason = s.deductionReason ? `${s.deductionReason}；申诉补发 ¥${amount}（${note}）` : `申诉补发 ¥${amount}（${note}）`;
    return this.settlements.save(s);
  }

  async listByAssignment(assignmentId: number) {
    return this.settlements.findOne({ where: { assignmentId } });
  }

  async listByJob(jobId: number) {
    return this.settlements.find({ where: { jobId }, order: { id: 'ASC' } });
  }

  async listByWorker(workerId: number) {
    return this.settlements.find({ where: { workerId }, order: { id: 'DESC' } });
  }

  /** 客服证据包：签到轨迹、主管确认、现场照片、聊天记录 */
  async buildEvidence(assignmentId: number) {
    const attendance = await this.attendance.find({ where: { assignmentId }, order: { eventTime: 'ASC' } });
    const events = await this.jobEvents.find({ where: { assignmentId }, order: { occurredAt: 'ASC' } });
    const policy = await this.policies.findOne({ where: { assignmentId } });
    const settlement = await this.settlements.findOne({ where: { assignmentId } });
    const appeal = await this.appeals.findOne({ where: { assignmentId }, order: { id: 'DESC' } });
    const transfers = await this.transfers.find({ where: { assignmentId }, order: { id: 'ASC' } });
    return { attendance, events, policy, settlement, appeal, transfers };
  }
}
