import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  User, Enterprise, Job, Assignment, AttendanceEvent, InsurancePolicy,
  JobEvent, InjuryClaim, ChatMessage, Settlement, PositionTransfer,
} from '../../entities';
import { INDUSTRIES } from '../../risk.constants';
import { haversineMeters } from '../../geo';
import { verifyQrToken } from '../../qrcode';
import { config } from '../../config';
import { SettlementService } from '../settlements/settlement.service';
import { EnterpriseService } from '../enterprise/enterprise.service';

export class CheckInDto {
  assignmentId: number;
  lat: number;
  lng: number;
  qrcodeToken: string;
  facePassed?: boolean; // 人脸比对结果（演示：前端模拟采集）
  photoUrl?: string;
}

const INSURER_PRODUCTS: Record<string, string> = {
  INVENTORY: '雇主责任险·通用A款',
  EXHIBITION: '高危作业人员意外险·搭建专项',
  WAREHOUSE: '物流分拣雇主责任险',
  CATERING: '餐饮服务人员意外险',
  CLEANING: '家政保洁意外险',
  SECURITY: '安保人员高危意外险',
};

@Injectable()
export class TasksService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(Enterprise) private enterprises: Repository<Enterprise>,
    @InjectRepository(Job) private jobs: Repository<Job>,
    @InjectRepository(Assignment) private assignments: Repository<Assignment>,
    @InjectRepository(AttendanceEvent) private attendance: Repository<AttendanceEvent>,
    @InjectRepository(InsurancePolicy) private policies: Repository<InsurancePolicy>,
    @InjectRepository(JobEvent) private jobEvents: Repository<JobEvent>,
    @InjectRepository(InjuryClaim) private claims: Repository<InjuryClaim>,
    @InjectRepository(ChatMessage) private messages: Repository<ChatMessage>,
    @InjectRepository(Settlement) private settlements: Repository<Settlement>,
    @InjectRepository(PositionTransfer) private transfers: Repository<PositionTransfer>,
    private settlementService: SettlementService,
    private entService: EnterpriseService,
  ) {}

  // ===================== 任务室聚合 =====================
  async room(assignmentId: number) {
    const assignment = await this.assignments.findOne({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException('派单不存在');
    const job = await this.jobs.findOne({ where: { id: assignment.jobId } });
    if (!job) throw new NotFoundException('岗位不存在');
    const enterprise = await this.enterprises.findOne({ where: { id: job.enterpriseId } });
    const worker = await this.users.findOne({ where: { id: assignment.workerId } });
    const supervisors = await this.users.find({ where: { role: 'SUPERVISOR', enterpriseId: job.enterpriseId } });
    const att = await this.attendance.find({ where: { assignmentId }, order: { eventTime: 'ASC' } });
    const policy = await this.policies.findOne({ where: { assignmentId } });
    const events = await this.jobEvents.find({ where: { assignmentId }, order: { occurredAt: 'DESC' } });
    const claim = await this.claims.findOne({ where: { assignmentId }, order: { id: 'DESC' } });
    const msgs = await this.messages.find({ where: { assignmentId }, order: { id: 'ASC' }, take: 200 });
    const settlement = await this.settlements.findOne({ where: { assignmentId } });
    const transfers = await this.transfers.find({ where: { assignmentId }, order: { id: 'DESC' } });

    return {
      assignment,
      job: { ...job, industryLabel: INDUSTRIES[job.industry]?.label },
      enterprise,
      worker: worker && {
        id: worker.id, name: worker.name, phone: worker.phone,
        idVerified: !!worker.idVerifiedAt, healthCertUntil: worker.healthCertUntil,
        hasFaceSample: !!worker.faceSampleUrl,
      },
      supervisors: supervisors.map((s) => ({ id: s.id, name: s.name, phone: s.phone })),
      attendance: att,
      pendingCheckIn: att.find((a) => a.kind === 'CHECK_IN' && !a.allPassed && a.locationPassed && a.facePassed && a.qrcodePassed) || null,
      policy,
      events,
      claim,
      messages: msgs,
      settlement,
      positionTransfers: transfers,
      activeTransfer: transfers[0] || null,
    };
  }

  // ===================== 录取即生成保单（待生效） =====================
  async createPendingPolicy(assignment: Assignment, job: Job) {
    const exists = await this.policies.findOne({ where: { assignmentId: assignment.id } });
    if (exists) return exists;
    const industry = INDUSTRIES[job.industry];
    // 岗位风险 = 行业基础风险 + 企业风险画像
    const ent = await this.enterprises.findOne({ where: { id: job.enterpriseId } });
    const jobRiskLevel = Math.min(5, industry.baseRiskLevel + Math.max(0, (ent?.riskLevel ?? 1) - 1));
    const policy = this.policies.create({
      assignmentId: assignment.id,
      jobId: job.id,
      workerId: assignment.workerId,
      enterpriseId: job.enterpriseId,
      insurerProduct: INSURER_PRODUCTS[job.industry] || '雇主责任险',
      coverageWan: job.insuranceCoverageWan,
      premium: job.insurancePremium,
      status: 'PENDING',
      jobRiskLevel,
      // 企业录取即视为企业确认承保该工人
      enterpriseConfirmed: true,
    });
    return this.policies.save(policy);
  }

  // ===================== 工人提交到岗签到（定位+人脸+二维码） =====================
  async checkIn(workerId: number, dto: CheckInDto) {
    const assignment = await this.assignments.findOne({ where: { id: dto.assignmentId, workerId } });
    if (!assignment) throw new ForbiddenException('派单不存在或不属于当前工人');
    if (!['ACCEPTED'].includes(assignment.status)) {
      throw new BadRequestException(`当前状态 ${assignment.status} 不能签到（需已被企业录取）`);
    }
    const job = await this.jobs.findOne({ where: { id: assignment.jobId } });
    if (!job) throw new NotFoundException('岗位不存在');
    const worker = await this.users.findOne({ where: { id: workerId } });

    // 要素 1：定位围栏
    const distance = haversineMeters(
      Number(dto.lat), Number(dto.lng), Number(job.lat), Number(job.lng),
    );
    const locationPassed = distance <= config.geofenceRadiusMeters;

    // 要素 2：人脸比对（演示：需已采集人脸样本，前端模拟比对得分）
    const facePassed = !!worker?.faceSampleUrl && dto.facePassed !== false;
    const faceScore = facePassed ? 92 + (workerId % 6) : 0;

    // 要素 3：动态二维码
    const qrcodePassed = verifyQrToken(job.id, String(dto.qrcodeToken || ''));

    // 要素 4：现场主管确认——工人不能自证，必须由主管在下一步独立确认
    const failReasons: string[] = [];
    if (!locationPassed) failReasons.push(`定位偏离签到点 ${distance}m（允许 ${config.geofenceRadiusMeters}m）`);
    if (!worker?.faceSampleUrl) failReasons.push('未采集人脸样本，无法人脸核验');
    else if (!facePassed) failReasons.push('人脸比对未通过');
    if (!qrcodePassed) failReasons.push('签到二维码无效或已过期（每分钟轮换）');

    const event = this.attendance.create({
      assignmentId: assignment.id,
      jobId: job.id,
      workerId,
      kind: 'CHECK_IN',
      locationPassed,
      lat: dto.lat,
      lng: dto.lng,
      distanceMeters: distance,
      facePassed,
      faceScore,
      supervisorConfirmed: false,
      qrcodePassed,
      qrcodeToken: dto.qrcodeToken,
      allPassed: false, // 等待主管确认
      failReason: failReasons.join('；') || '定位/人脸/二维码通过，等待现场主管确认',
      photoUrl: dto.photoUrl || null,
      eventTime: new Date(),
    });
    const saved = await this.attendance.save(event);

    if (failReasons.length) {
      return { attendance: saved, nextStep: 'FIX_FACTORS', message: `签到校验未通过：${failReasons.join('；')}` };
    }
    return { attendance: saved, nextStep: 'WAIT_SUPERVISOR', message: '定位、人脸、二维码核验通过，请现场主管确认到岗' };
  }

  // ===================== 现场主管确认（高风险企业双人确认） =====================
  async supervisorConfirm(user: { sub: number; role: string; enterpriseId?: number | null }, attendanceId: number) {
    const event = await this.attendance.findOne({ where: { id: attendanceId } });
    if (!event) throw new NotFoundException('签到记录不存在');
    const job = await this.jobs.findOne({ where: { id: event.jobId } });
    if (!job) throw new NotFoundException('岗位不存在');
    if (user.role === 'SUPERVISOR' && user.enterpriseId !== job.enterpriseId) {
      throw new ForbiddenException('只能确认本企业岗位');
    }
    if (user.role === 'ENTERPRISE' && user.enterpriseId !== job.enterpriseId) {
      throw new ForbiddenException();
    }
    if (event.kind !== 'CHECK_IN') throw new BadRequestException('仅到岗签到需要主管确认');
    if (event.allPassed) throw new BadRequestException('该签到已完成确认');
    if (!event.locationPassed || !event.facePassed || !event.qrcodePassed) {
      throw new BadRequestException('定位/人脸/二维码未全部通过，请工人重新提交签到');
    }

    if (!event.supervisorConfirmed) {
      event.supervisorConfirmed = true;
      event.confirmedBySupervisorId = user.sub;
      event.confirmedAt = new Date();
      if (!job.strictConfirmation) {
        event.allPassed = true;
        event.failReason = null;
      } else {
        event.failReason = '高风险企业岗位：第一确认完成，等待第二名负责人复核';
      }
      await this.attendance.save(event);
      if (!job.strictConfirmation) return this.afterCheckIn(event);
      return { attendance: event, nextStep: 'WAIT_SECOND_CONFIRM' };
    }

    // 双人复核（须与第一确认人不同）
    if (event.confirmedBySupervisorId === user.sub) {
      throw new BadRequestException('第二名复核人不能与第一确认人为同一人');
    }
    event.secondConfirmed = true;
    event.secondConfirmedBy = user.sub;
    event.allPassed = true;
    event.failReason = null;
    await this.attendance.save(event);
    return this.afterCheckIn(event);
  }

  /** 四重校验全部通过 → 到岗成立 → 保险即时生效（系统时间，不可事后补录） */
  private async afterCheckIn(event: AttendanceEvent) {
    const assignment = await this.assignments.findOne({ where: { id: event.assignmentId } });
    const job = await this.jobs.findOne({ where: { id: event.jobId } });
    if (!assignment || !job) throw new NotFoundException();

    assignment.status = 'CHECKED_IN';
    await this.assignments.save(assignment);
    if (job.status !== 'IN_PROGRESS') {
      job.status = 'IN_PROGRESS';
      await this.jobs.save(job);
    }

    // 保险生效：生效时间锚定服务器记录的实际到岗时间
    const policy = await this.policies.findOne({ where: { assignmentId: assignment.id } });
    if (policy && policy.status === 'PENDING') {
      if (!policy.enterpriseConfirmed) {
        throw new BadRequestException('企业尚未确认承保，保险不能生效');
      }
      policy.status = 'ACTIVE';
      policy.effectiveFrom = new Date(event.eventTime);
      policy.activatedByAttendanceId = event.id;
      await this.policies.save(policy);
    }
    assignment.status = 'WORKING';
    await this.assignments.save(assignment);

    return {
      attendance: event,
      nextStep: 'INSURANCE_ACTIVE',
      message: `四重校验通过，到岗成立，保险已于 ${new Date(event.eventTime).toLocaleString('zh-CN')} 即时生效`,
      insurancePolicy: policy,
    };
  }

  // ===================== 完工签退 =====================
  async checkOut(workerId: number, dto: CheckInDto) {
    const assignment = await this.assignments.findOne({ where: { id: dto.assignmentId, workerId } });
    if (!assignment) throw new ForbiddenException();
    if (!['WORKING', 'CHECKED_IN'].includes(assignment.status)) {
      throw new BadRequestException('未到岗或已结束，不能签退');
    }
    const job = await this.jobs.findOne({ where: { id: assignment.jobId } });
    const worker = await this.users.findOne({ where: { id: workerId } });
    const distance = haversineMeters(Number(dto.lat), Number(dto.lng), Number(job.lat), Number(job.lng));
    const locationPassed = distance <= config.geofenceRadiusMeters;
    const facePassed = !!worker?.faceSampleUrl && dto.facePassed !== false;
    const qrcodePassed = verifyQrToken(job.id, String(dto.qrcodeToken || ''));
    const fails: string[] = [];
    if (!locationPassed) fails.push(`定位偏离 ${distance}m`);
    if (!facePassed) fails.push('人脸核验未通过');
    if (!qrcodePassed) fails.push('二维码无效或已过期');
    if (fails.length) throw new BadRequestException(`签退校验未通过：${fails.join('；')}`);

    const event = await this.attendance.save(this.attendance.create({
      assignmentId: assignment.id,
      jobId: job.id,
      workerId,
      kind: 'CHECK_OUT',
      locationPassed, lat: dto.lat, lng: dto.lng, distanceMeters: distance,
      facePassed, faceScore: 90 + (workerId % 8),
      supervisorConfirmed: true, confirmedBySupervisorId: null, confirmedAt: new Date(),
      qrcodePassed, qrcodeToken: dto.qrcodeToken,
      secondConfirmed: !job.strictConfirmation || true,
      allPassed: true,
      photoUrl: dto.photoUrl || null,
      eventTime: new Date(),
    }));

    // 早退判定
    const earlyLeave = await this.jobEvents.findOne({
      where: { assignmentId: assignment.id, type: 'EARLY_LEAVE', status: 'APPROVED' },
    });
    assignment.status = earlyLeave ? 'LEFT_EARLY' : 'COMPLETED';
    await this.assignments.save(assignment);

    // 保险保障截止
    const policy = await this.policies.findOne({ where: { assignmentId: assignment.id } });
    if (policy && policy.status === 'ACTIVE') {
      policy.status = 'EXPIRED';
      policy.effectiveTo = new Date();
      await this.policies.save(policy);
    }

    // 生成日结明细
    const settlement = await this.settlementService.generate(assignment.id);

    // 同岗位全部完工 → 岗位结束、释放保证金
    const remaining = await this.assignments.count({
      where: { jobId: job.id, status: In(['ACCEPTED', 'CHECKED_IN', 'WORKING']) },
    });
    let depositReleased = 0;
    if (remaining === 0) {
      job.status = 'COMPLETED';
      await this.jobs.save(job);
      const before = Number((await this.entService.get(job.enterpriseId)).depositFrozen);
      // 只释放本岗位对应的冻结额度
      depositReleased = Number(job.depositRequired);
      await this.entService.release(job.enterpriseId, depositReleased);
      void before;
    }

    return { attendance: event, settlement, depositReleased, message: '签退成功，日结明细已生成' };
  }

  // ===================== 作业过程事件（现场实时上报） =====================
  async reportEvent(
    workerId: number,
    dto: {
      assignmentId: number; type: any; description: string;
      minutes?: number; newPosition?: string; photoUrl?: string; lat?: number; lng?: number;
      claimAmount?: number;
    },
  ) {
    const assignment = await this.assignments.findOne({ where: { id: dto.assignmentId, workerId } });
    if (!assignment) throw new ForbiddenException();
    const job = await this.jobs.findOne({ where: { id: assignment.jobId } });
    if (!['WORKING', 'CHECKED_IN'].includes(assignment.status) && dto.type !== 'WAGE_DISPUTE') {
      throw new BadRequestException('只有作业中的任务可以上报该事件（工资争议可在结算后发起申诉）');
    }
    if (!dto.description?.trim()) throw new BadRequestException('请填写事件描述');

    // occurredAt 一律取服务器当前时间——现场实时上报，禁止事后补录篡改时间
    const event = await this.jobEvents.save(this.jobEvents.create({
      assignmentId: assignment.id,
      jobId: job.id,
      workerId,
      type: dto.type,
      description: dto.description,
      occurredAt: new Date(),
      minutes: dto.minutes ?? null,
      newPosition: dto.newPosition ?? null,
      photoUrl: dto.photoUrl ?? null,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      status: 'PENDING',
    }));

    let claim: InjuryClaim | null = null;
    if (dto.type === 'INJURY') {
      const policy = await this.policies.findOne({ where: { assignmentId: assignment.id } });
      // 事故发生时点保险是否在保障期内——以系统时间判定，事后无法改变
      const covered = !!policy &&
        policy.status === 'ACTIVE' &&
        !!policy.effectiveFrom &&
        new Date() >= new Date(policy.effectiveFrom) &&
        (!policy.effectiveTo || new Date() <= new Date(policy.effectiveTo));
      claim = await this.claims.save(this.claims.create({
        assignmentId: assignment.id,
        jobId: job.id,
        workerId,
        enterpriseId: job.enterpriseId,
        jobEventId: event.id,
        insurancePolicyId: policy?.id ?? 0,
        injuryDesc: dto.description,
        claimAmount: dto.claimAmount || 5000,
        status: 'INVESTIGATING',
        coveredAtOccurrence: covered,
        adjusterNote: covered
          ? '事故发生于保险保障期内，进入理赔调查'
          : '事故发生时保险未生效（未完成四重到岗校验或企业未确认），不在保障范围，且平台禁止事后补录保险',
      }));
    }

    return { event, claim, message: '事件已现场实时上报，等待现场主管/企业处理' };
  }

  /** 主管/企业处理作业事件 */
  async reviewEvent(user: { sub: number; role: string; enterpriseId?: number | null }, eventId: number, approve: boolean, note?: string) {
    const event = await this.jobEvents.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException('事件不存在');
    const job = await this.jobs.findOne({ where: { id: event.jobId } });
    if (user.enterpriseId !== job.enterpriseId) throw new ForbiddenException();
    if (event.status !== 'PENDING') throw new BadRequestException('该事件已处理');
    // 岗位调换必须由工人本人在岗位调换单上确认/拒绝，主管不能代替确认
    if (event.type === 'POSITION_CHANGE') {
      throw new BadRequestException('岗位调换须由工人在任务室确认或拒绝，主管不能代为批准');
    }
    event.status = approve ? 'APPROVED' : 'REJECTED';
    event.reviewedBy = user.sub;
    event.reviewedAt = new Date();
    event.reviewNote = note || null;
    await this.jobEvents.save(event);

    let claim: InjuryClaim | null = null;
    if (event.type === 'INJURY') {
      claim = await this.claims.findOne({ where: { jobEventId: event.id } });
      if (claim) {
        // coveredAtOccurrence 不可变——即使主管批准事件，保险不赔就是不赔
        claim.status = approve
          ? (claim.coveredAtOccurrence ? 'APPROVED' : 'REJECTED')
          : 'REJECTED';
        claim.adjusterNote = `${claim.adjusterNote || ''}\n主管${approve ? '确认' : '驳回'}工伤事件：${note || '无备注'}`.trim();
        await this.claims.save(claim);
        if (approve) {
          // 真实发生工伤即计入企业风险画像（不论保险是否赔付）
          const ent = await this.entService.get(job.enterpriseId);
          ent.injuryJobs += 1;
          await this.enterprises.save(ent);
          await this.entService.recomputeRisk(job.enterpriseId);
        }
      }
    }

    // 影响工时/金额的事件批准后重算结算
    let settlement: Settlement | null = null;
    if (approve && ['OVERTIME', 'EARLY_LEAVE', 'EXTRA_CARRY', 'POSITION_CHANGE'].includes(event.type)) {
      const existing = await this.settlements.findOne({ where: { assignmentId: event.assignmentId } });
      if (existing) settlement = await this.settlementService.generate(event.assignmentId);
    }

    return { event, claim, settlement };
  }

  // ===================== 聊天（证据链一部分） =====================
  async postMessage(user: { sub: number; role: string; name: string; enterpriseId?: number | null }, assignmentId: number, content: string) {
    const assignment = await this.assignments.findOne({ where: { id: assignmentId } });
    if (!assignment) throw new NotFoundException('派单不存在');
    const job = await this.jobs.findOne({ where: { id: assignment.jobId } });
    const allowed = user.sub === assignment.workerId ||
      (user.enterpriseId === job.enterpriseId && ['ENTERPRISE', 'SUPERVISOR'].includes(user.role));
    if (!allowed) throw new ForbiddenException('只有任务参与方可以发言');
    if (!content?.trim()) throw new BadRequestException('消息不能为空');
    return this.messages.save(this.messages.create({
      assignmentId, senderId: user.sub, senderName: user.name, senderRole: user.role, content: content.trim(),
    }));
  }

  // ===================== 主管现场工作台：待确认签到 / 待处理事件 =====================
  async fieldBoard(enterpriseId: number) {
    const jobs = await this.jobs.find({ where: { enterpriseId } });
    const jobIds = jobs.map((j) => j.id);
    const jobMap = new Map(jobs.map((j) => [j.id, j]));

    const pendingAttendance: any[] = [];
    const recentAttendance: any[] = [];
    if (jobIds.length) {
      const evs = await this.attendance.find({
        where: { jobId: In(jobIds), kind: 'CHECK_IN' },
        order: { createdAt: 'DESC' },
        take: 100,
      });
      for (const ev of evs) {
        const a = await this.assignments.findOne({ where: { id: ev.assignmentId } });
        const w = a ? await this.users.findOne({ where: { id: a.workerId } }) : null;
        const row = {
          ...ev,
          workerName: w?.name || `#${ev.workerId}`,
          jobTitle: jobMap.get(ev.jobId)?.title,
          strictConfirmation: jobMap.get(ev.jobId)?.strictConfirmation,
        };
        if (!ev.allPassed && ev.locationPassed && ev.facePassed && ev.qrcodePassed) pendingAttendance.push(row);
        else recentAttendance.push(row);
      }
    }

    const pendingEvents: any[] = [];
    if (jobIds.length) {
      const evs = await this.jobEvents.find({
        where: { jobId: In(jobIds), status: 'PENDING' },
        order: { createdAt: 'DESC' },
        take: 100,
      });
      for (const ev of evs) {
        const w = await this.users.findOne({ where: { id: ev.workerId } });
        pendingEvents.push({
          ...ev,
          workerName: w?.name || `#${ev.workerId}`,
          jobTitle: jobMap.get(ev.jobId)?.title,
        });
      }
    }

    // 岗位临时调换：待工人确认，或工人拒绝后待主管做到场补偿复核
    const pendingTransfers: any[] = [];
    if (jobIds.length) {
      const trs = await this.transfers.find({
        where: { jobId: In(jobIds) },
        order: { id: 'DESC' },
        take: 100,
      });
      for (const t of trs) {
        const needFollowUp = t.status === 'PENDING' ||
          (t.status === 'REJECTED' && t.arrivalCompensation === 'REQUIRED' && t.compensationResolvedAt === null);
        if (!needFollowUp) continue;
        const w = await this.users.findOne({ where: { id: t.workerId } });
        pendingTransfers.push({
          ...t,
          workerName: w?.name || `#${t.workerId}`,
          jobTitle: jobMap.get(t.jobId)?.title,
        });
      }
    }

    return {
      pendingAttendance, recentAttendance: recentAttendance.slice(0, 20),
      pendingEvents, pendingTransfers, jobs,
    };
  }

  // ===================== 爽约标记 =====================
  async markNoShow(user: { sub: number; role: string; enterpriseId?: number | null }, assignmentId: number) {
    const a = await this.assignments.findOne({ where: { id: assignmentId } });
    if (!a) throw new NotFoundException();
    const job = await this.jobs.findOne({ where: { id: a.jobId } });
    if (user.enterpriseId !== job.enterpriseId) throw new ForbiddenException();
    if (a.status !== 'ACCEPTED') throw new BadRequestException('仅已录取但未到岗者可标记爽约');
    if (Date.now() < new Date(job.startTime).getTime() + 15 * 60000) {
      throw new BadRequestException('开工 15 分钟后仍未到岗才能标记爽约');
    }
    a.status = 'NO_SHOW';
    await this.assignments.save(a);
    const policy = await this.policies.findOne({ where: { assignmentId } });
    if (policy && policy.status === 'PENDING') {
      policy.status = 'VOID';
      await this.policies.save(policy);
    }
    return a;
  }
}
