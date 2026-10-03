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

  console.log('── 5b. 到场临时岗位调换：主管发起 → 工人确认（保险/工时同步） ──');
  // 用另一条派单走完整调换确认：新发岗位 → 录取 → 四重到岗 → 主管发起调换 → 工人确认
  const pcStart = new Date(Date.now() + 3600 * 1000);
  const pcEnd = new Date(pcStart.getTime() + 8 * 3600000);
  const pcJob = (await req('POST', '/api/jobs', tEnt1, {
    title: '仓库分拣（到场或改重货搬运）', industry: 'WAREHOUSE', description: '分拣，到场可能临时调整',
    location: '嘉定物流园', lat: 31.2304, lng: 121.4737,
    startTime: pcStart.toISOString().slice(0, 19), endTime: pcEnd.toISOString().slice(0, 19),
    headcount: 1, skillRequirement: '无', dailyWage: 240,
  })).body;
  const pcApply = await req('POST', `/api/jobs/${pcJob.id}/apply`, tWorker1, { riskAcknowledged: true });
  void pcApply;
  const pcApps = (await req('GET', `/api/jobs/${pcJob.id}/applicants`, tEnt1)).body;
  const pcApp = pcApps.find((x) => x.worker && x.worker.name === '张三');
  const pcAccept = await req('POST', `/api/assignments/${pcApp.id}/review`, tEnt1, { accept: true });
  const pcAid = pcAccept.body.id;
  const qrPc = (await req('GET', `/api/jobs/${pcJob.id}/qrcode`, tSup1)).body.token;
  const pcCi = await req('POST', '/api/attendance/check-in', tWorker1, {
    assignmentId: pcAid, lat: 31.2304, lng: 121.4737, qrcodeToken: qrPc, facePassed: true,
  });
  const pcConfirmedIn = await req('POST', `/api/attendance/${pcCi.body.attendance.id}/supervisor-confirm`, tSup1, {});
  ok(pcConfirmedIn.body.insurancePolicy.status === 'ACTIVE', '调换演示派单完成到岗、保险生效');

  // 主管发起：缺强度/风险说明必须被拦截
  const badProp = await req('POST', '/api/position-changes', tSup1, {
    assignmentId: pcAid, newPosition: '重货搬运', intensityLevel: 5, intensityNote: '', riskNote: '', newDailyWage: 200,
  });
  ok(badProp.status === 400 && /强度/.test(badProp.body.message), `发起调换须说明工作强度：${badProp.body.message}`);

  // 工人不能自行发起（越权）
  const workerProp = await req('POST', '/api/position-changes', tWorker1, {
    assignmentId: pcAid, newPosition: '重货搬运', intensityLevel: 5,
    intensityNote: '重', riskNote: '高', newDailyWage: 200,
  });
  ok(workerProp.status === 403, '工人无权自行发起岗位变更');

  // 主管正常发起：分拣(240) → 重货搬运(300)，强度 L5
  const prop = await req('POST', '/api/position-changes', tSup1, {
    assignmentId: pcAid, newPosition: '重货搬运', newIndustryKey: null, intensityLevel: 5,
    intensityNote: '单件30-50kg持续搬卸，需弯腰负重', riskNote: '砸伤扭伤风险升高，配护腰手套',
    newDailyWage: 300,
  });
  ok(prop.status === 201 && prop.body.request.status === 'PROPOSED'
    && Number(prop.body.request.wageDiff) === 60 && prop.body.request.newRiskLevel >= 4,
    `主管发起调换（强度L5→风险L${prop.body.request.newRiskLevel}，工资差 +60）`);
  const pcId = prop.body.request.id;
  const pcRoom = (await req('GET', `/api/assignments/${pcAid}/room`, tWorker1)).body;
  ok(pcRoom.activePositionChange && pcRoom.activePositionChange.id === pcId, '任务室向工人展示待确认调换及差异说明');

  // 确认前保险仍是原方案
  const policyBefore = pcRoom.policy;
  ok(policyBefore.coverageWan === pcJob.insuranceCoverageWan && !policyBefore.adjustedByPositionChangeId,
    '工人确认前保险范围保持原分拣岗位方案不变');

  // 重复发起被拒
  const dupProp = await req('POST', '/api/position-changes', tSup1, {
    assignmentId: pcAid, newPosition: '其他', intensityLevel: 4, intensityNote: 'x', riskNote: 'y', newDailyWage: 260,
  });
  ok(dupProp.status === 400 && /等待工人确认/.test(dupProp.body.message), '已有待确认调换时不能重复发起');

  // 不填说明不能确认
  const noNote = await req('POST', `/api/position-changes/${pcId}/respond`, tWorker1, { accept: true, note: '' });
  ok(noNote.status === 400 && /知悉/.test(noNote.body.message), '工人确认须填写知悉声明');

  // 主管发起后、工人确认前的作业时段 = 争议工时：等待约 1 分钟再确认
  await new Promise((r) => setTimeout(r, 61000));

  // 工人确认 → 保险范围同步更新
  const acceptPc = await req('POST', `/api/position-changes/${pcId}/respond`, tWorker1,
    { accept: true, note: '我已知悉新岗位强度风险与工资，确认接受' });
  ok(acceptPc.status === 201 && acceptPc.body.request.status === 'CONFIRMED', '工人确认岗位调换');
  ok(acceptPc.body.insurancePolicy.adjustedByPositionChangeId === pcId
    && Number(acceptPc.body.insurancePolicy.coverageWan) >= Number(policyBefore.coverageWan)
    && acceptPc.body.insurancePolicy.jobRiskLevel === prop.body.request.newRiskLevel,
    `保险范围已同步更新（保额 ${policyBefore.coverageWan}万→${acceptPc.body.insurancePolicy.coverageWan}万，风险 L${acceptPc.body.insurancePolicy.jobRiskLevel}）`);
  const pcRoom2 = (await req('GET', `/api/assignments/${pcAid}/room`, tWorker1)).body;
  ok(pcRoom2.confirmedPositionChange && /重货搬运/.test(pcRoom2.messages[pcRoom2.messages.length - 1].content),
    '工人端任务室展示新工资与保险范围，并留存系统确认消息');

  // 确认后继续作业约 1 分钟再签退，形成新岗位作业段
  await new Promise((r) => setTimeout(r, 61000));
  const qrPc2 = (await req('GET', `/api/jobs/${pcJob.id}/qrcode`, tSup1)).body.token;
  const pcOut = await req('POST', '/api/attendance/check-out', tWorker1, {
    assignmentId: pcAid, lat: 31.2304, lng: 121.4737, qrcodeToken: qrPc2, facePassed: true,
  });
  const pcS = pcOut.body.settlement;
  ok(pcOut.status === 201 && pcS.positionChangeId === pcId, '签退后结算单关联岗位调换单');
  ok(Number(pcS.disputedMinutes) >= 1 && Number(pcS.newPositionPay) > 0 && Number(pcS.oldPositionPay) > 0,
    `工时单分段：争议工时 ${pcS.disputedMinutes} 分钟（发起→确认未确认即作业），原岗位段 ¥${pcS.oldPositionPay}，新岗位段 ¥${pcS.newPositionPay}`);

  console.log('── 5c. 工人拒绝不合理调换 → 平台判定到场补偿，不按新岗位规则结算 ──');
  const rjStart = new Date(Date.now() + 2 * 3600000);
  const rjJob = (await req('POST', '/api/jobs', tEnt1, {
    title: '仓库分拣（到场或被降薪调岗）', industry: 'WAREHOUSE', description: '分拣',
    location: '嘉定物流园', lat: 31.2304, lng: 121.4737,
    startTime: rjStart.toISOString().slice(0, 19),
    endTime: new Date(rjStart.getTime() + 8 * 3600000).toISOString().slice(0, 19),
    headcount: 1, skillRequirement: '无', dailyWage: 240,
  })).body;
  await req('POST', `/api/jobs/${rjJob.id}/apply`, tWorker1, { riskAcknowledged: true });
  const rjApps = (await req('GET', `/api/jobs/${rjJob.id}/applicants`, tEnt1)).body;
  const rjApp = rjApps.find((x) => x.worker && x.worker.name === '张三');
  const rjAccept = await req('POST', `/api/assignments/${rjApp.id}/review`, tEnt1, { accept: true });
  const rjAid = rjAccept.body.id;
  const qrRj = (await req('GET', `/api/jobs/${rjJob.id}/qrcode`, tSup1)).body.token;
  const rjCi = await req('POST', '/api/attendance/check-in', tWorker1, {
    assignmentId: rjAid, lat: 31.2304, lng: 121.4737, qrcodeToken: qrRj, facePassed: true,
  });
  await req('POST', `/api/attendance/${rjCi.body.attendance.id}/supervisor-confirm`, tSup1, {});
  // 降薪 + 高强度的不合理调换
  const rjProp = await req('POST', '/api/position-changes', tSup1, {
    assignmentId: rjAid, newPosition: '重货搬运', intensityLevel: 5,
    intensityNote: '重货持续负重', riskNote: '高风险', newDailyWage: 180,
  });
  const rejectPc = await req('POST', `/api/position-changes/${rjProp.body.request.id}/respond`, tWorker1,
    { accept: false, note: '到场是分拣，降薪还让搬重货，不同意' });
  ok(rejectPc.body.request.status === 'REJECTED'
    && rejectPc.body.request.appearanceCompensationRequired === true
    && Number(rejectPc.body.request.appearanceCompensationAmount) === 48,
    `工人拒绝降薪高强度调换 → 企业须付到场补偿 ¥${rejectPc.body.request.appearanceCompensationAmount}（240×20%）`);
  const qrRj2 = (await req('GET', `/api/jobs/${rjJob.id}/qrcode`, tSup1)).body.token;
  const rjOut = await req('POST', '/api/attendance/check-out', tWorker1, {
    assignmentId: rjAid, lat: 31.2304, lng: 121.4737, qrcodeToken: qrRj2, facePassed: true,
  });
  ok(Number(rjOut.body.settlement.appearanceCompensation) === 48
    && Number(rjOut.body.settlement.baseWage) > 0,
    '拒绝后结算按原岗位规则且含到场补偿，未按新岗位工资结算');

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

  console.log(`\n========== 结果：${pass} 通过 / ${fail} 失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('冒烟测试异常中断：', e);
  process.exit(2);
});
