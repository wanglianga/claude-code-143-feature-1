import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Appeal, Assignment, Job, Enterprise, AttendanceEvent, JobEvent, ChatMessage,
  Settlement, InsurancePolicy, InjuryClaim, PositionChangeRequest,
} from '../../entities';
import { SettlementService } from '../settlements/settlement.service';
import { EnterpriseService } from '../enterprise/enterprise.service';

@Injectable()
export class AppealsService {
  constructor(
    @InjectRepository(Appeal) private appeals: Repository<Appeal>,
    @InjectRepository(Assignment) private assignments: Repository<Assignment>,
    @InjectRepository(Job) private jobs: Repository<Job>,
    @InjectRepository(Enterprise) private enterprises: Repository<Enterprise>,
    @InjectRepository(AttendanceEvent) private attendance: Repository<AttendanceEvent>,
    @InjectRepository(JobEvent) private jobEvents: Repository<JobEvent>,
    @InjectRepository(ChatMessage) private messages: Repository<ChatMessage>,
    @InjectRepository(Settlement) private settlements: Repository<Settlement>,
    @InjectRepository(InjuryClaim) private claims: Repository<InjuryClaim>,
    @InjectRepository(PositionChangeRequest) private positionChanges: Repository<PositionChangeRequest>,
    private settlementService: SettlementService,
    private entService: EnterpriseService,
  ) {}

  /** 工人发起申诉（工资被扣/其他争议），系统自动固化证据快照 */
  async create(workerId: number, assignmentId: number, reason: string, claimedAmount: number) {
    const a = await this.assignments.findOne({ where: { id: assignmentId, workerId } });
    if (!a) throw new ForbiddenException('派单不存在或不属于当前工人');
    if (!reason?.trim()) throw new BadRequestException('请填写申诉理由');
    const job = await this.jobs.findOne({ where: { id: a.jobId } });

    const existing = await this.appeals.findOne({ where: { assignmentId } });
    if (existing && !['UPHELD', 'ARBITRATION_AWARD'].includes(existing.status)) {
      throw new BadRequestException('该任务已有进行中的申诉');
    }

    const evidence = await this.buildEvidence(assignmentId);
    const appeal = await this.appeals.save(this.appeals.create({
      assignmentId,
      jobId: a.jobId,
      workerId,
      enterpriseId: job.enterpriseId,
      reason: reason.trim(),
      claimedAmount: claimedAmount || 0,
      status: 'OPEN',
      evidenceSummary: evidence.summary,
    }));

    // 企业争议计数（同一派单只计一次）
    if (!existing) {
      const ent = await this.entService.get(job.enterpriseId);
      ent.disputedAssignments += 1;
      await this.enterprises.save(ent);
      await this.entService.recomputeRisk(job.enterpriseId);
    }
    return appeal;
  }

  async listForWorker(workerId: number) {
    return this.appeals.find({ where: { workerId }, order: { id: 'DESC' } });
  }

  async listForEnterprise(enterpriseId: number) {
    const list = await this.appeals.find({ where: { enterpriseId }, order: { id: 'DESC' } });
    return list;
  }

  async listAll(status?: string) {
    const list = await this.appeals.find({
      where: status ? { status: status as any } : {},
      order: { id: 'DESC' },
    });
    return list;
  }

  /** 客服证据包：签到轨迹、主管确认、现场照片、聊天记录 */
  async buildEvidence(assignmentId: number) {
    const att = await this.appeals.manager.find(AttendanceEvent, { where: { assignmentId }, order: { eventTime: 'ASC' } });
    const events = await this.jobEvents.find({ where: { assignmentId }, order: { occurredAt: 'ASC' } });
    const positionChanges = await this.positionChanges.find({ where: { assignmentId }, order: { id: 'ASC' } });
    const msgs = await this.messages.find({ where: { assignmentId }, order: { id: 'ASC' }, take: 300 });
    const settlement = await this.settlements.findOne({ where: { assignmentId } });
    const pol = await this.appeals.manager.findOne(InsurancePolicy, { where: { assignmentId } });

    const summary = [
      `签到记录 ${att.length} 条：`,
      ...att.map((x) =>
        `  - [${x.kind}] ${new Date(x.eventTime).toLocaleString('zh-CN')} 定位${x.locationPassed ? '✓' : '✗'}(${x.distanceMeters}m) ` +
        `人脸${x.facePassed ? '✓' : '✗'} 二维码${x.qrcodePassed ? '✓' : '✗'} 主管确认${x.supervisorConfirmed ? '✓' : '✗'}` +
        `${x.secondConfirmed ? ' 双人复核✓' : ''} 照片${x.photoUrl ? '有' : '无'}`),
      `作业事件 ${events.length} 条：`,
      ...events.map((x) =>
        `  - [${x.type}] ${new Date(x.occurredAt).toLocaleString('zh-CN')} ${x.status} ${x.description}` +
        `${x.minutes ? `(${x.minutes}分钟)` : ''}${x.photoUrl ? ' 附照片' : ''} 审核:${x.reviewNote || '-'}`,
      ),
      `岗位调换 ${positionChanges.length} 条：`,
      ...positionChanges.map((x) =>
        `  - [${x.status}] ${new Date(x.initiatedAt).toLocaleString('zh-CN')} ${x.newPosition} ` +
        `强度L${x.intensityLevel} 风险L${x.newRiskLevel} 工资¥${x.originalDailyWage}→¥${x.newDailyWage}` +
        (x.workerRespondedAt ? ` 工人${new Date(x.workerRespondedAt).toLocaleString('zh-CN')}响应` : '') +
        (x.appearanceCompensationRequired ? ` 到场补偿¥${x.appearanceCompensationAmount}` : '')),
      `保险：${pol ? `${pol.status}，生效 ${pol.effectiveFrom ? new Date(pol.effectiveFrom).toLocaleString('zh-CN') : '未生效'}` : '无保单'}`,
      `结算：${settlement ? `应发 ¥${settlement.workerPayable}，迟到扣款 ¥${settlement.lateDeduction}，争议工时 ${settlement.disputedMinutes} 分钟，状态 ${settlement.status}` : '未生成'}`,
      `聊天记录 ${msgs.length} 条（详见证据包）`,
    ].join('\n');

    return { attendance: att, events, positionChanges, messages: msgs, settlement, policy: pol, summary };
  }

  async evidence(appealId: number) {
    const appeal = await this.appeals.findOne({ where: { id: appealId } });
    if (!appeal) throw new NotFoundException('申诉不存在');
    const pack = await this.buildEvidence(appeal.assignmentId);
    return { appeal, ...pack };
  }

  /** 客服裁决：补发 / 维持扣款 / 升级仲裁 */
  async decide(supportUserId: number, appealId: number, decision: 'REISSUED' | 'UPHELD' | 'ARBITRATION', note: string, reissueAmount?: number) {
    const appeal = await this.appeals.findOne({ where: { id: appealId } });
    if (!appeal) throw new NotFoundException('申诉不存在');
    if (!['OPEN', 'ARBITRATION'].includes(appeal.status)) throw new BadRequestException('该申诉已裁决');
    if (!note?.trim()) throw new BadRequestException('请填写裁决依据');

    appeal.handledBy = supportUserId;
    appeal.handledAt = new Date();
    appeal.decisionNote = note.trim();

    if (decision === 'UPHELD') {
      appeal.status = 'UPHELD';
      await this.appeals.save(appeal);
      // 工人败诉：维持扣款，不调整结算
      return appeal;
    }

    if (decision === 'ARBITRATION') {
      appeal.status = 'ARBITRATION';
      await this.appeals.save(appeal);
      return appeal;
    }

    // REISSUED 补发
    const amount = Math.max(0, Number(reissueAmount ?? appeal.claimedAmount) || 0);
    if (amount <= 0) throw new BadRequestException('补发金额必须大于 0');
    appeal.status = 'REISSUED';
    appeal.reissueAmount = amount;
    await this.appeals.save(appeal);
    await this.settlementService.applyReissue(appeal, amount, note.trim());
    await this.countLostDispute(appeal);
    return appeal;
  }

  /** 仲裁终局裁决 */
  async arbitrate(supportUserId: number, appealId: number, award: string, reissueAmount: number) {
    const appeal = await this.appeals.findOne({ where: { id: appealId } });
    if (!appeal) throw new NotFoundException('申诉不存在');
    if (appeal.status !== 'ARBITRATION') throw new BadRequestException('仅升级仲裁中的案件可裁决');
    if (!award?.trim()) throw new BadRequestException('请填写仲裁裁决书内容');
    appeal.arbitrationAward = award.trim();
    appeal.arbitratedAt = new Date();
    appeal.handledBy = supportUserId;
    const amount = Math.max(0, Number(reissueAmount) || 0);
    if (amount > 0) {
      appeal.reissueAmount = amount;
      appeal.status = 'ARBITRATION_AWARD';
      await this.appeals.save(appeal);
      await this.settlementService.applyReissue(appeal, amount, `仲裁裁决：${award.trim()}`);
      await this.countLostDispute(appeal);
    } else {
      appeal.status = 'ARBITRATION_AWARD';
      await this.appeals.save(appeal);
    }
    return appeal;
  }

  private async countLostDispute(appeal: Appeal) {
    // 企业有责（补发）计入 lostDisputes，仅计一次
    if (appeal.reissueAmount && Number(appeal.reissueAmount) > 0) {
      const ent = await this.entService.get(appeal.enterpriseId);
      const before = ent.lostDisputes;
      ent.lostDisputes = before + 1;
      await this.enterprises.save(ent);
      await this.entService.recomputeRisk(appeal.enterpriseId);
    }
  }

  // ---------- 客服：工伤理赔复核 ----------
  async listClaims() {
    return this.claims.find({ order: { id: 'DESC' } });
  }

  async adjustClaim(claimId: number, approve: boolean, note: string) {
    const claim = await this.claims.findOne({ where: { id: claimId } });
    if (!claim) throw new NotFoundException('理赔单不存在');
    // coveredAtOccurrence 是事故时点的不可变事实：不允许通过客服复核把未生效保单变成赔付
    if (approve && !claim.coveredAtOccurrence) {
      throw new BadRequestException('事故发生时保险未生效，禁止赔付——平台不允许事故后补录保险');
    }
    claim.status = approve ? 'APPROVED' : 'REJECTED';
    claim.adjusterNote = `${claim.adjusterNote || ''}\n客服复核：${note || '无'}`.trim();
    return this.claims.save(claim);
  }
}
