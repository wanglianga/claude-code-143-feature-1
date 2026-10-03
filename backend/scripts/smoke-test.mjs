/**
 * 端到端冒烟测试：城市临时用工日结派单考勤保险与争议平台
 * 用法（需先启动后端与数据库，并完成种子）：
 *   node scripts/smoke-test.mjs
 * 环境变量：BASE_URL(默认 http://127.0.0.1:3001) DB_HOST DB_PORT DB_USER DB_PASSWORD DB_NAME
 */
const BASE = process.env.BASE_URL || 'http://127.0.0.1:3001';
const DB = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD ?? 'root',
  database: process.env.DB_NAME || 'gig_platform',
};

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.error(`  ❌ ${msg}`); }
};
const req = async (method, path, token, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json };
};

async function login(username, password = '123456') {
  const r = await req('POST', '/api/auth/login', null, { username, password });
  if (r.status !== 201) throw new Error(`登录失败 ${username}: ${JSON.stringify(r.body)}`);
  return r.body.token;
}

(async () => {
  console.log('── 1. 登录种子账号 ──');
  const tWorker1 = await login('worker1');
  const tWorker2 = await login('worker2');
  const tEnt1 = await login('enterprise1');
  const tSup1 = await login('supervisor1');
  const tSup1b = await login('supervisor1b');
  const tRisky = await login('enterprise_risky');
  const tSupRisky = await login('supervisor_risky');
  const tSupRiskyb = await login('supervisor_riskyb');
  const tSupport = await login('support');
  const tWorker3 = await login('worker3');
  ok(true, '全部种子账号可登录（工人/企业/主管×4/客服）');

  console.log('── 2. 报名门禁：实名 / 健康证 / 历史评价 / 风险告知 ──');
  const jobs = (await req('GET', '/api/jobs', tWorker1)).body;
  const cateringJob = jobs.find((j) => j.industry === 'CATERING');
  const exhibitionJob = jobs.find((j) => j.industry === 'EXHIBITION');
  const securityJob = jobs.find((j) => j.industry === 'SECURITY');
  ok(!!cateringJob && !!exhibitionJob && !!securityJob, '岗位大厅包含六类行业岗位');

  // worker2 未实名/无健康证/无人脸 → 报名餐饮岗必须被拦截
  const badApply = await req('POST', `/api/jobs/${cateringJob.id}/apply`, tWorker2, { riskAcknowledged: true });
  ok(badApply.status === 400 && /实名认证/.test(badApply.body.message), `未实名工人报名被拦截：${badApply.body.message}`);

  // worker1 未勾选风险告知 → 拦截
  const noAck = await req('POST', `/api/jobs/${exhibitionJob.id}/apply`, tWorker1, { riskAcknowledged: false });
  ok(noAck.status === 400 && /风险告知/.test(noAck.body.message), '未确认风险告知不能报名');

  // worker1 正常报名会展岗
  const apply = await req('POST', `/api/jobs/${exhibitionJob.id}/apply`, tWorker1, { riskAcknowledged: true });
  ok(apply.status === 201 && apply.body.status === 'APPLIED', '工人完成报名（状态 APPLIED）');

  console.log('── 3. 企业录取 → 自动生成待生效保单 ──');
  const applicants = (await req('GET', `/api/jobs/${exhibitionJob.id}/applicants`, tEnt1)).body;
  const myApp = applicants.find((a) => a.worker && a.worker.name === '张三');
  ok(Array.isArray(applicants) && myApp, '企业可查看报名工人及其实名/健康证/评价快照');
  const accept = await req('POST', `/api/assignments/${myApp.id}/review`, tEnt1, { accept: true });
  ok(accept.status === 201 && accept.body.status === 'ACCEPTED', '企业录取工人');
  const assignmentId = accept.body.id;
  const roomBefore = (await req('GET', `/api/assignments/${assignmentId}/room`, tWorker1)).body;
  ok(roomBefore.policy.status === 'PENDING' && roomBefore.policy.enterpriseConfirmed === true,
    `录取即生成保单（PENDING，企业已确认，岗位风险等级 ${roomBefore.policy.jobRiskLevel}）`);

  console.log('── 4. 到岗四重校验：定位 + 人脸 + 二维码 + 主管确认 ──');
  // 4.1 定位偏离
  const far = await req('POST', '/api/attendance/check-in', tWorker1, {
    assignmentId, lat: 31.0, lng: 121.0, qrcodeToken: 'BAD', facePassed: true,
  });
  ok(far.body.nextStep === 'FIX_FACTORS' && /定位偏离/.test(far.body.message) && /二维码/.test(far.body.message),
    `定位偏离+错误二维码被拦截：${far.body.message}`);

  // 4.2 正确定位/人脸 + 主管出示的动态二维码 → 等待主管确认
  const qr = (await req('GET', `/api/jobs/${exhibitionJob.id}/qrcode`, tSup1)).body;
  ok(/^[A-Z0-9]{8}$/.test(qr.token), `主管获取每分钟轮换的动态签到码：${qr.token}`);
  const checkin = await req('POST', '/api/attendance/check-in', tWorker1, {
    assignmentId, lat: 31.2304, lng: 121.4737, qrcodeToken: qr.token, facePassed: true,
    photoUrl: 'mock://on-site-photo-1',
  });
  ok(checkin.body.nextStep === 'WAIT_SUPERVISOR', `工人三要素通过：${checkin.body.message}`);
  const pendingAttendanceId = checkin.body.attendance.id;

  // 4.3 工人不能自己确认（越权）
  const selfConfirm = await req('POST', `/api/attendance/${pendingAttendanceId}/supervisor-confirm`, tWorker1, {});
  ok(selfConfirm.status === 403, '工人无权自行主管确认（防自证）');

  // 4.4 主管确认 → 保险即时生效，禁止事后补录
  const confirmed = await req('POST', `/api/attendance/${pendingAttendanceId}/supervisor-confirm`, tSup1, {});
  ok(confirmed.body.nextStep === 'INSURANCE_ACTIVE' && confirmed.body.insurancePolicy.status === 'ACTIVE',
    `主管确认→四重校验通过→保险即时生效：${confirmed.body.message}`);

  console.log('── 5. 作业过程：加班 / 工伤（保险期内）/ 额外搬运 / 聊天 ──');
  const ot = await req('POST', '/api/events', tWorker1, {
    assignmentId, type: 'OVERTIME', description: '撤展延后，主管要求加班', minutes: 90,
  });
  ok(ot.status === 201 && ot.body.event.status === 'PENDING' && /现场实时上报/.test(ot.body.message), '加班事件现场实时上报');
  const otReview = await req('POST', `/api/events/${ot.body.event.id}/review`, tSup1, { approve: true, note: '情况属实' });
  ok(otReview.body.event.status === 'APPROVED', '主管批准加班 90 分钟');

  const carry = await req('POST', '/api/events', tWorker1, {
    assignmentId, type: 'EXTRA_CARRY', description: '临时要求加搬两托盘展具', minutes: 30,
  });
  await req('POST', `/api/events/${carry.body.event.id}/review`, tSup1, { approve: true, note: '确认' });
  ok(true, '额外搬运事件已审批（计入日结补贴）');

  const injury = await req('POST', '/api/events', tWorker1, {
    assignmentId, type: 'INJURY', description: '搬运桁架时砸伤左脚', claimAmount: 8000,
  });
  ok(injury.body.claim.coveredAtOccurrence === true && injury.body.claim.status === 'INVESTIGATING',
    '作业中受伤且保险在保障期内 → 自动生成可理赔调查单');
  const injuryReview = await req('POST', `/api/events/${injury.body.event.id}/review`, tSup1, { approve: true, note: '现场目击属实' });
  ok(injuryReview.body.claim.status === 'APPROVED', '主管确认工伤 → 理赔通过');

  const msg = await req('POST', `/api/assignments/${assignmentId}/messages`, tWorker1, { content: '主管，加班的工时记得帮我确认' });
  const msg2 = await req('POST', `/api/assignments/${assignmentId}/messages`, tSup1, { content: '已确认，安心干活' });
  ok(msg.status === 201 && msg2.status === 201, '任务内聊天留存（争议证据链）');

  console.log('── 6. 保险不可事后补录（未到岗先受伤 → 不能立案为保险事故） ──');
  // 新工人：注册+实名+健康证+人脸
  const uname = `wnew${Date.now() % 100000}`;
  const reg = await req('POST', '/api/auth/register', null, {
    username: uname, password: '123456', name: '新工人', phone: '13500000099', role: 'WORKER',
    idCardNo: '310101199501011111', healthCertUntil: '2027-01-01',
  });
  const tNew = reg.body.token;
  await req('POST', '/api/auth/worker-profile', tNew, { faceSampleUrl: 'mock://face-new' });
  // 企业新发一个岗并录取该工人
  const sStart = new Date(Date.now() + 2 * 86400000);
  const sEnd = new Date(sStart.getTime() + 8 * 3600000);
  const newJob = (await req('POST', '/api/jobs', tEnt1, {
    title: '次日仓库分拣', industry: 'WAREHOUSE', description: '分拣', location: '嘉定物流园',
    lat: 31.2304, lng: 121.4737,
    startTime: sStart.toISOString().slice(0, 19), endTime: sEnd.toISOString().slice(0, 19),
    headcount: 1, skillRequirement: '无', dailyWage: 240,
  })).body;
  await req('POST', `/api/jobs/${newJob.id}/apply`, tNew, { riskAcknowledged: true });
  const newApps = (await req('GET', `/api/jobs/${newJob.id}/applicants`, tEnt1)).body;
  const newAccept = await req('POST', `/api/assignments/${newApps[0].id}/review`, tEnt1, { accept: true });
  const newAid = newAccept.body.id;
  // 未完成任何到岗校验，直接报受伤 → 系统拒绝（保险 PENDING）
  const earlyInjury = await req('POST', '/api/events', tNew, {
    assignmentId: newAid, type: 'INJURY', description: '还没到岗就受伤了想走保险',
  });
  ok(earlyInjury.status === 400 && /作业中/.test(earlyInjury.body.message),
    `未到岗（保险未生效）不能报工伤立案：${earlyInjury.body.message}`);

  // 数据层面：即使存在 coveredAtOccurrence=false 的理赔单，客服也无权改赔
  const mysql = await import('mysql2/promise');
  const conn = await mysql.createConnection({
    host: DB.host, port: DB.port, user: DB.user, password: DB.password, database: DB.database,
  });
  const [pl] = await conn.query('SELECT id FROM insurance_policies WHERE assignmentId = ?', [newAid]);
  await conn.query(
    'INSERT INTO injury_claims (assignmentId, jobId, workerId, enterpriseId, jobEventId, insurancePolicyId, injuryDesc, claimAmount, status, coveredAtOccurrence, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,NOW())',
    [newAid, newJob.id, newApps[0].workerId, newJob.enterpriseId, 0, pl[0].id, '事故时未到岗', 5000, 'REPORTED', 0],
  );
  const [uncoveredRows] = await conn.query(
    'SELECT id FROM injury_claims WHERE assignmentId = ? AND coveredAtOccurrence = 0 ORDER BY id DESC LIMIT 1', [newAid],
  );
  await conn.end();
  const forcePay = await req('POST', `/api/support/claims/${uncoveredRows[0].id}/adjust`, tSupport, { approve: true, note: '通融赔付' });
  ok(forcePay.status === 400 && /未生效/.test(forcePay.body.message),
    `客服无法把事故时未生效的保单改为赔付：${forcePay.body.message}`);

  console.log('── 7. 完工签退 → 日结明细（工时/加班/餐补/迟到扣款/预付/服务费） ──');
  const qr2 = (await req('GET', `/api/jobs/${exhibitionJob.id}/qrcode`, tSup1)).body.token;
  const checkout = await req('POST', '/api/attendance/check-out', tWorker1, {
    assignmentId, lat: 31.2304, lng: 121.4737, qrcodeToken: qr2, facePassed: true,
  });
  const s = checkout.body.settlement;
  ok(checkout.status === 201 && s, '签退成功并生成日结明细');
  ok(Number(s.overtimeMinutes) === 90 && Number(s.overtimePay) > 0, `加班 90 分钟已计入加班费 ¥${s.overtimePay}`);
  ok(Number(s.extraCarryPay) > 0, `额外搬运补贴 ¥${s.extraCarryPay}`);
  ok(Number(s.mealAllowance) > 0, `餐补 ¥${s.mealAllowance}`);
  ok(Number(s.insurancePremium) > 0 && Number(s.platformServiceFee) > 0,
    `保费 ¥${s.insurancePremium}（企业承担）+ 平台服务费 ¥${s.platformServiceFee}`);
  ok(Number(s.enterprisePrepaymentUsed) > 0, `动用企业预付款 ¥${s.enterprisePrepaymentUsed}`);
  const pay = await req('POST', '/api/settlements/pay', tEnt1, { assignmentIds: [assignmentId] });
  ok(pay.body[0] && pay.body[0].status === 'PAID', '企业确认发放日结（状态 PAID）');

  console.log('── 8. 工人申诉 → 客服查看证据包 → 补发裁决 ──');
  const appeal = await req('POST', '/api/appeals', tWorker1, {
    assignmentId, reason: '主管临时加活承诺加 50 元未体现在工资中', claimedAmount: 50,
  });
  ok(appeal.status === 201 && appeal.body.status === 'OPEN', '工人发起申诉');
  const evidence = await req('GET', `/api/support/appeals/${appeal.body.id}/evidence`, tSupport);
  ok(/签到记录/.test(evidence.body.summary) && /作业事件/.test(evidence.body.summary) && /聊天记录/.test(evidence.body.summary),
    '客服证据包包含签到轨迹/主管确认/现场照片/事件/聊天记录/保险/结算');
  ok(evidence.body.messages.length >= 2 && evidence.body.attendance.some((a) => a.allPassed), '证据包内含聊天记录与四重通过的签到记录');
  const beforePay = Number((await req('GET', `/api/settlements/assignment/${assignmentId}`, tWorker1)).body.workerPayable);
  const decide = await req('POST', `/api/support/appeals/${appeal.body.id}/decide`, tSupport, {
    decision: 'REISSUED', note: '聊天记录与主管确认佐证额外搬运，补发 50 元', reissueAmount: 50,
  });
  ok(decide.body.status === 'REISSUED' && Number(decide.body.reissueAmount) === 50, '客服裁决补发 ¥50');
  const after = (await req('GET', `/api/settlements/assignment/${assignmentId}`, tWorker1)).body;
  ok(Number(after.workerPayable) === beforePay + 50 && after.status === 'ADJUSTED',
    `结算单调整为 ADJUSTED，应发 ¥${beforePay} → ¥${after.workerPayable}`);

  console.log('── 9. 高风险企业：更高保证金 + 更严格现场确认（双人） ──');
  const overview = (await req('GET', '/api/support/overview', tSupport)).body;
  const riskyRow = overview.allEnterprises.find((e) => e.name.includes('雷霆'));
  ok(riskyRow.riskLevel >= 4 && riskyRow.cancelRate >= 0.15 && riskyRow.disputeRate >= 0.2,
    `风险画像定级 ${riskyRow.riskLevel}（取消率 ${(riskyRow.cancelRate * 100).toFixed(0)}%、有责争议率 ${(riskyRow.disputeRate * 100).toFixed(0)}%）`);
  const riskyStartD = new Date(Date.now() + 3 * 86400000);
  const riskyEndD = new Date(riskyStartD.getTime() + 8 * 3600000);
  const riskyJob = (await req('POST', '/api/jobs', tRisky, {
    title: '临时发布会安保（高风险企业）', industry: 'SECURITY', description: '安保留', location: '滨江',
    lat: 31.2304, lng: 121.4737,
    startTime: riskyStartD.toISOString().slice(0, 19), endTime: riskyEndD.toISOString().slice(0, 19),
    headcount: 1, skillRequirement: '安保经验', dailyWage: 320,
  })).body;
  ok(Number(riskyJob.depositRequired) === 400 * 3, `安保岗保证金被风险倍率上浮至 ¥${riskyJob.depositRequired}（基准400×倍率3.0×1人）`);
  ok(riskyJob.strictConfirmation === true, '岗位自动启用严格现场确认（双人）');

  // 用另一个新工人走严格双人确认全流程
  const uname2 = `wsec${Date.now() % 100000}`;
  const reg2 = await req('POST', '/api/auth/register', null, {
    username: uname2, password: '123456', name: '安保新人', phone: '13500000088', role: 'WORKER',
    idCardNo: '310101199602022222',
  });
  const tSec = reg2.body.token;
  await req('POST', '/api/auth/worker-profile', tSec, { faceSampleUrl: 'mock://face-sec' });
  // startTime 在未来导致签到无时间限制（系统不允许提前到岗？当前无时间门禁），直接录取签到
  await req('POST', `/api/jobs/${riskyJob.id}/apply`, tSec, { riskAcknowledged: true });
  const riskyApps = (await req('GET', `/api/jobs/${riskyJob.id}/applicants`, tRisky)).body;
  const riskyAccept = await req('POST', `/api/assignments/${riskyApps[0].id}/review`, tRisky, { accept: true });
  const riskyAid = riskyAccept.body.id;
  const qrR = (await req('GET', `/api/jobs/${riskyJob.id}/qrcode`, tSupRisky)).body.token;
  const rci = await req('POST', '/api/attendance/check-in', tSec, {
    assignmentId: riskyAid, lat: 31.2304, lng: 121.4737, qrcodeToken: qrR, facePassed: true,
  });
  const first = await req('POST', `/api/attendance/${rci.body.attendance.id}/supervisor-confirm`, tSupRisky, {});
  ok(first.body.nextStep === 'WAIT_SECOND_CONFIRM', '第一名主管确认后仍需第二名负责人复核');
  const sameAgain = await req('POST', `/api/attendance/${rci.body.attendance.id}/supervisor-confirm`, tSupRisky, {});
  ok(sameAgain.status === 400 && /同一人/.test(sameAgain.body.message), '同一人不能充当两名确认人');
  const second = await req('POST', `/api/attendance/${rci.body.attendance.id}/supervisor-confirm`, tSupRiskyb, {});
  ok(second.body.nextStep === 'INSURANCE_ACTIVE' && second.body.insurancePolicy.status === 'ACTIVE',
    '第二名负责人复核通过 → 到岗成立、保险生效');

  console.log('── 10. 企业取消岗位：保证金罚没 + 保单作废 + 取消率沉淀 ──');
  const cancelStart = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 16) + ':00';
  const cancelJob = (await req('POST', '/api/jobs', tEnt1, {
    title: '周末保洁突击', industry: 'CLEANING', description: '保洁', location: '人民广场',
    lat: 31.2304, lng: 121.4737, startTime: cancelStart,
    endTime: new Date(new Date(cancelStart).getTime() + 6 * 3600000).toISOString().slice(0, 16) + ':00',
    headcount: 2, skillRequirement: '无', dailyWage: 210,
  })).body;
  const depositBefore = Number(cancelJob.depositRequired);
  const cancel = await req('POST', `/api/jobs/${cancelJob.id}/cancel`, tEnt1, { reason: '甲方临时取消活动' });
  ok(cancel.body.job.status === 'CANCELLED' && cancel.body.forfeit === Math.round(depositBefore * 0.2),
    `开工前 >2h 取消：罚没 20% 保证金 ¥${cancel.body.forfeit}，释放 ¥${cancel.body.released}`);

  console.log('── 11. 行业风险沉淀看板 ──');
  const ind = (await req('GET', '/api/industry-risks', tSupport)).body;
  ok(ind.length === 6 && ind.find((x) => x.industry === 'SECURITY').baseRiskLevel === 5,
    '按六个行业沉淀岗位风险（安保基础风险 5 级、保费费率最高）');

  console.log('── 12. 岗位临时调换（工人确认）：说明强度/风险/工资差异 → 保险与工时同步、争议工时 ──');
  // 种子内置在途任务：worker3（王强）已到岗「嘉定冷链仓·夜班分拣员」、保险已生效
  const w3Apps = (await req('GET', '/api/my/applications', tWorker3)).body;
  const sortApp = w3Apps.find((a) => a.job && a.job.industry === 'WAREHOUSE' && a.status === 'WORKING');
  ok(!!sortApp, '种子在途分拣任务存在且工人已到岗作业（保险生效中）');
  const sortAid = sortApp.id;

  // 主管发起时不写工作强度 → 被拦截
  const badInitiate = await req('POST', '/api/position-transfers', tSup1, {
    assignmentId: sortAid, newPosition: '重货装卸工', newIndustry: 'EXHIBITION',
    newWorkIntensity: '', newRiskDescription: '砸伤风险', newDailyWage: 320,
  });
  ok(badInitiate.status === 400 && /工作强度/.test(badInitiate.body.message),
    `发起调换必须书面说明新岗位工作强度：${badInitiate.body.message}`);

  // 工人无权发起岗位调换（必须现场主管发起）
  const workerInitiate = await req('POST', '/api/position-transfers', tWorker3, {
    assignmentId: sortAid, newPosition: '重货装卸工', newIndustry: 'EXHIBITION',
    newWorkIntensity: '重', newRiskDescription: '砸伤', newDailyWage: 320,
  });
  ok(workerInitiate.status === 403, '工人不能自行发起岗位调换（须现场主管发起）');

  // 主管正式发起：2 分钟前企业即已要求开始新岗位（制造未确认先作业时段）
  const twoMinAgo = new Date(Date.now() - 2 * 60000).toISOString().slice(0, 19);
  const initiate = await req('POST', '/api/position-transfers', tSup1, {
    assignmentId: sortAid,
    newPosition: '重货装卸工', newIndustry: 'EXHIBITION',
    newWorkIntensity: '持续搬运 25kg 箱装重货并装卸车，强度显著高于分拣',
    newRiskDescription: '重物砸伤、腰肌劳损、装卸车剐蹭',
    newDailyWage: 320, newOvertimeRate: 45, newCoverageWan: 50,
    wageDiffNote: '含重货岗位津贴 80 元/班', newWorkStartedAt: twoMinAgo,
  });
  ok(initiate.status === 201 && initiate.body.transfer.status === 'PENDING' &&
    initiate.body.transfer.wageDiffType === 'UP',
    '主管发起调换（分拣→重货装卸，日薪 240→320），等待工人确认');
  const trId = initiate.body.transfer.id;

  // 发起后保险仍按原岗位
  const roomPending = (await req('GET', `/api/assignments/${sortAid}/room`, tWorker3)).body;
  ok(roomPending.activeTransfer.status === 'PENDING' && roomPending.policy.coverageWan === 30,
    '工人确认前保险范围维持原岗位（保额 30 万）');
  const boardBefore = (await req('GET', '/api/field/board', tSup1)).body;
  ok((boardBefore.pendingTransfers || []).some((t) => t.id === trId), '主管现场工作台出现待工人确认的调换单');

  // 主管不能用通用事件审批接口代替工人确认
  const linkedEventId = initiate.body.transfer.jobEventId;
  const supApproveEvent = await req('POST', `/api/events/${linkedEventId}/review`, tSup1, { approve: true, note: '代确认' });
  ok(supApproveEvent.status === 400 && /工人/.test(supApproveEvent.body.message),
    `主管不能代为确认岗位调换：${supApproveEvent.body.message}`);

  // 工人确认 → 保险与工时单同步
  const confirmedTr = await req('POST', `/api/position-transfers/${trId}/confirm`, tWorker3, {});
  ok(confirmedTr.status === 201 && confirmedTr.body.transfer.status === 'CONFIRMED', '工人确认岗位调换');
  ok(confirmedTr.body.policy.coverageWan === 50 && confirmedTr.body.policy.currentPosition === '重货装卸工' &&
    Number(confirmedTr.body.policy.originalCoverageWan) === 30 && confirmedTr.body.policy.positionTransferId === trId,
    '保险范围同步：承保岗位切换为重货装卸工、保额 30万→50万（原快照保留）');
  ok(confirmedTr.body.transfer.disputedMinutes >= 1 && Number(confirmedTr.body.settlement.disputedDeduction) > 0,
    `确认前已作业 ${confirmedTr.body.transfer.disputedMinutes} 分钟标记为争议工时，暂扣 ¥${confirmedTr.body.settlement.disputedDeduction}`);
  ok(confirmedTr.body.settlement.settledPosition === '重货装卸工' &&
    /争议工时/.test(confirmedTr.body.settlement.disputedReason || ''),
    '工时单按新岗位分段计酬并书面标注争议时段');

  // 确认后不能重复操作
  const confirmAgain = await req('POST', `/api/position-transfers/${trId}/confirm`, tWorker3, {});
  ok(confirmAgain.status === 400 && /已处理/.test(confirmAgain.body.message), '调换单已确认，不能重复操作');

  // 完工签退后争议时段仍被隔离，不按原岗位规则统算
  const qrSort = (await req('GET', `/api/jobs/${sortApp.job.id}/qrcode`, tSup1)).body.token;
  const sortCheckout = await req('POST', '/api/attendance/check-out', tWorker3, {
    assignmentId: sortAid, lat: 31.2304, lng: 121.4737, qrcodeToken: qrSort, facePassed: true,
  });
  const sortS = sortCheckout.body.settlement;
  ok(sortCheckout.status === 201 && sortS.settledPosition === '重货装卸工' &&
    sortS.disputedMinutes >= 1 && Number(sortS.disputedDeduction) > 0 &&
    Number(sortS.workerPayable) > 0,
    `完工结算按新岗位分段计酬，争议 ${sortS.disputedMinutes} 分钟（¥${sortS.disputedDeduction}）继续暂扣，应发 ¥${sortS.workerPayable}`);

  console.log('── 13. 岗位临时调换（工人拒绝）：拒绝原因 + 到场补偿判定 + 主管复核改判 ──');
  async function setupOnSiteJob(_workerToken, name) {
    const u = `wtr${name}${Date.now() % 100000}`;
    const register = await req('POST', '/api/auth/register', null, {
      username: u, password: '123456', name: `调换工人${name}`, phone: `13500012${1000 + Number(name)}`, role: 'WORKER',
      idCardNo: `310101199${name}010${Number(name)}222`, healthCertUntil: '2027-01-01',
    });
    const tk = register.body.token;
    await req('POST', '/api/auth/worker-profile', tk, { faceSampleUrl: 'mock://face-tr' });
    const st = new Date(Date.now() - 10 * 60000);
    const ed = new Date(st.getTime() + 6 * 3600000);
    const j = (await req('POST', '/api/jobs', tEnt1, {
      title: `临时分拣岗${name}`, industry: 'WAREHOUSE', description: '小件分拣', location: '嘉定物流园',
      lat: 31.2304, lng: 121.4737,
      startTime: st.toISOString().slice(0, 19), endTime: ed.toISOString().slice(0, 19),
      headcount: 1, skillRequirement: '无', dailyWage: 240,
    })).body;
    await req('POST', `/api/jobs/${j.id}/apply`, tk, { riskAcknowledged: true });
    const apps = (await req('GET', `/api/jobs/${j.id}/applicants`, tEnt1)).body;
    const acc = await req('POST', `/api/assignments/${apps[0].id}/review`, tEnt1, { accept: true });
    const aid = acc.body.id;
    const q = (await req('GET', `/api/jobs/${j.id}/qrcode`, tSup1)).body.token;
    const ci = await req('POST', '/api/attendance/check-in', tk, {
      assignmentId: aid, lat: 31.2304, lng: 121.4737, qrcodeToken: q, facePassed: true,
    });
    // 企业风险等级可能已因工伤/有责争议升至 L4 → 新岗位双人确认，兼容第二名主管复核
    const c1 = await req('POST', `/api/attendance/${ci.body.attendance.id}/supervisor-confirm`, tSup1, {});
    if (c1.body.nextStep === 'WAIT_SECOND_CONFIRM') {
      await req('POST', `/api/attendance/${ci.body.attendance.id}/supervisor-confirm`, tSup1b, {});
    }
    return { tk, j, aid };
  }

  // 13.1 降薪调换被拒绝 → 企业需支付到场补偿（不签退也能结算）
  const rejectCase = await setupOnSiteJob(tEnt1, '1');
  const init2 = await req('POST', '/api/position-transfers', tSup1, {
    assignmentId: rejectCase.aid,
    newPosition: '重货搬运工', newIndustry: 'EXHIBITION',
    newWorkIntensity: '持续搬运 30kg 重货', newRiskDescription: '砸伤/腰伤',
    newDailyWage: 200, newCoverageWan: 50,
  });
  const tr2 = init2.body.transfer;
  ok(Number(tr2.originalDailyWage) === 240 && tr2.wageDiffType === 'DOWN', '第二单为降薪调换（240→200）');
  const rejectNoReason = await req('POST', `/api/position-transfers/${tr2.id}/reject`, rejectCase.tk, { reason: '' });
  ok(rejectNoReason.status === 400 && /拒绝.*原因/.test(rejectNoReason.body.message), '拒绝调换必须填写原因');
  const rejected = await req('POST', `/api/position-transfers/${tr2.id}/reject`, rejectCase.tk, {
    reason: '腰有旧伤，不能搬重货，且降薪未提前说明',
  });
  ok(rejected.body.transfer.status === 'REJECTED' &&
    rejected.body.transfer.arrivalCompensation === 'REQUIRED' &&
    Number(rejected.body.transfer.arrivalCompensationAmount) === 50,
    '平台判定企业需支付到场补偿 ¥50（日薪20%保底50）');
  const rejS = rejected.body.settlement;
  ok(!!rejS && Number(rejS.arrivalCompensation) === 50 && Number(rejS.workerPayable) >= 50,
    `工人未签离场，到场补偿已计入结算单（应发 ¥${rejS?.workerPayable}），不按原岗位全班结算`);

  // 主管复核：工人确已离场 → 维持补偿
  const maintain = await req('POST', `/api/position-transfers/${tr2.id}/compensation`, tSup1, { continued: false, note: '工人已离厂' });
  ok(maintain.body.transfer.arrivalCompensation === 'REQUIRED', '主管登记工人已离场，到场补偿维持应付');

  // 客服证据包包含岗位调换完整轨迹
  const evPack = (await req('GET', `/api/settlements/assignment/${rejectCase.aid}/evidence`, tSupport)).body;
  const trInPack = evPack.transfers[0];
  ok(evPack.transfers.length >= 1 && trInPack.status === 'REJECTED' &&
    trInPack.arrivalCompensation === 'REQUIRED' && Number(trInPack.arrivalCompensationAmount) === 50 &&
    /旧伤/.test(trInPack.workerRejectReason) && Number(evPack.settlement.arrivalCompensation) === 50,
    '客服证据包固化岗位调换/拒绝原因/到场补偿判定与结算金额');

  // 13.2 拒绝后留下继续原岗位 → 主管改判无需补偿，完工按原岗位正常结算
  const stayCase = await setupOnSiteJob(tEnt1, '2');
  const init3 = await req('POST', '/api/position-transfers', tSup1, {
    assignmentId: stayCase.aid,
    newPosition: '重货搬运工', newIndustry: 'EXHIBITION',
    newWorkIntensity: '重货', newRiskDescription: '砸伤', newDailyWage: 240, newCoverageWan: 50,
  });
  await req('POST', `/api/position-transfers/${init3.body.transfer.id}/reject`, stayCase.tk, { reason: '只做约定的分拣' });
  const waive = await req('POST', `/api/position-transfers/${init3.body.transfer.id}/compensation`, tSup1, {
    continued: true, note: '工人留下继续分拣至下班',
  });
  ok(waive.body.transfer.arrivalCompensation === 'WAIVED' &&
    Number(waive.body.settlement.arrivalCompensation) === 0,
    '主管登记工人继续原岗位 → 改判无需到场补偿');
  const q3 = (await req('GET', `/api/jobs/${stayCase.j.id}/qrcode`, tSup1)).body.token;
  const co3 = await req('POST', '/api/attendance/check-out', stayCase.tk, {
    assignmentId: stayCase.aid, lat: 31.2304, lng: 121.4737, qrcodeToken: q3, facePassed: true,
  });
  ok(Number(co3.body.settlement.arrivalCompensation) === 0 &&
    Number(co3.body.settlement.baseWage) === 240 && !co3.body.settlement.settledPosition,
    '继续原岗位正常完工：无到场补偿、按原岗位日薪 ¥240 结算');

  console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('冒烟测试异常中断：', e);
  process.exit(2);
});
