import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, post } from '../../api';
import { Alert, Badge, EventTypeTag, Field, Spinner, StatusBadge, fmtDateTime, fmtMoney } from '../../components/ui';

export default function AppealDesk() {
  const { id } = useParams();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState(0);
  const [award, setAward] = useState('');
  const [awardAmount, setAwardAmount] = useState(0);

  const load = () => get(`/support/appeals/${id}/evidence`).then((r) => {
    setD(r);
    setAmount(Number(r.appeal.claimedAmount || 0));
  });
  useEffect(() => { load(); }, [id]);

  const decide = async (decision: 'REISSUED' | 'UPHELD' | 'ARBITRATION') => {
    setError(''); setMsg('');
    try {
      await post(`/support/appeals/${id}/decide`, { decision, note, reissueAmount: amount });
      setMsg(decision === 'REISSUED' ? `已裁决补发 ¥${amount}` : decision === 'UPHELD' ? '已裁决维持扣款' : '已升级仲裁');
      await load();
    } catch (e: any) { setError(e.message); }
  };

  const arbitrate = async () => {
    setError(''); setMsg('');
    try {
      await post(`/support/appeals/${id}/arbitrate`, { award, reissueAmount: awardAmount });
      setMsg('仲裁终局裁决已记录');
      await load();
    } catch (e: any) { setError(e.message); }
  };

  if (!d) return <Spinner />;
  const a = d.appeal;
  const done = !['OPEN', 'ARBITRATION'].includes(a.status);

  return (
    <div>
      <Link className="btn btn-sm" to="/support/appeals">← 工单列表</Link>
      <div className="fab-space" />
      <h1>申诉工单 #{a.id}</h1>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="ok">{msg}</Alert>}

      <div className="card">
        <div className="row">
          <StatusBadge status={a.status} />
          <span>工人 #{a.workerId} 诉企业 #{a.enterpriseId}</span>
          <div className="spacer" />
          <span>诉求补发 <b className="money">{fmtMoney(a.claimedAmount)}</b></span>
        </div>
        <p style={{ margin: '10px 0' }}><b>申诉理由：</b>{a.reason}</p>
        <div className="small muted">提起时间：{fmtDateTime(a.createdAt)}</div>
        {a.decisionNote && <div className="alert alert-info" style={{ marginTop: 10 }}>客服处理记录：{a.decisionNote}（{fmtDateTime(a.handledAt)}）</div>}
        {a.arbitrationAward && <div className="alert alert-warn" style={{ marginTop: 10 }}>仲裁裁决书：{a.arbitrationAward}（{fmtDateTime(a.arbitratedAt)}）</div>}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>签到轨迹与四重校验</h2>
          <div className="timeline">
            {d.attendance.map((e: any) => (
              <div key={e.id} className="t-item">
                <div className="row">
                  <b>{e.kind === 'CHECK_IN' ? '到岗签到' : '完工签退'}</b>
                  {e.allPassed ? <Badge tone="green">四重通过</Badge> : <Badge tone="red">未全通过</Badge>}
                  <span className="small muted">{fmtDateTime(e.eventTime)}</span>
                </div>
                <div className="small" style={{ marginTop: 4 }}>
                  定位 {e.locationPassed ? '✅' : '❌'}（{e.distanceMeters}m）·
                  人脸 {e.facePassed ? `✅ ${e.faceScore}分` : '❌'} ·
                  二维码 {e.qrcodePassed ? '✅' : '❌'} ·
                  主管 {e.supervisorConfirmed ? `✅ #${e.confirmedBySupervisorId} @${fmtDateTime(e.confirmedAt)}` : '❌'}
                  {e.secondConfirmed && ` · 双人复核✅ #${e.secondConfirmedBy}`}
                </div>
                {e.photoUrl && <div className="small">📷 现场照片：<span className="muted">{e.photoUrl}</span></div>}
                {e.failReason && <div className="small" style={{ color: 'var(--orange)' }}>{e.failReason}</div>}
              </div>
            ))}
            {d.attendance.length === 0 && <div className="muted small">无考勤记录</div>}
          </div>

          <h2 style={{ marginTop: 16 }}>作业事件</h2>
          {d.events.map((e: any) => (
            <div key={e.id} style={{ padding: '8px 0', borderBottom: '1px dashed var(--line)' }}>
              <div className="row">
                <EventTypeTag type={e.type} />
                <StatusBadge status={e.status} />
                <span className="small muted">{fmtDateTime(e.occurredAt)}</span>
                {e.minutes ? <span className="small">{e.minutes} 分钟</span> : null}
              </div>
              <div className="small" style={{ marginTop: 2 }}>{e.description}{e.photoUrl ? ' 📷' : ''}</div>
              {e.reviewNote && <div className="small muted">主管审核：{e.reviewNote}</div>}
            </div>
          ))}
          {d.events.length === 0 && <div className="muted small">无作业事件</div>}

          <h2 style={{ marginTop: 16 }}>岗位临时调换（{(d.transfers || []).length}）</h2>
          {(d.transfers || []).length === 0 && <div className="muted small">无岗位调换记录</div>}
          {(d.transfers || []).map((t: any) => (
            <div key={t.id} style={{ padding: '8px 0', borderBottom: '1px dashed var(--line)' }}>
              <div className="row">
                {t.status === 'CONFIRMED' ? <Badge tone="green">工人已确认</Badge>
                  : t.status === 'REJECTED' ? <Badge tone="red">工人已拒绝</Badge>
                  : <Badge tone="orange">待工人确认</Badge>}
                <b className="small">{t.originalPosition} → {t.newPosition}</b>
                <span className="small muted">{fmtDateTime(t.initiatedAt)}</span>
              </div>
              <div className="small" style={{ marginTop: 2 }}>
                日薪 ¥{t.originalDailyWage} → ¥{t.newDailyWage}（{t.wageDiffType}）；保额 {t.originalCoverageWan}万 → {t.newCoverageWan}万；
                强度：{t.newWorkIntensity}；风险：{t.newRiskDescription}
              </div>
              {t.workerConfirmedAt && (
                <div className="small">工人确认于 {fmtDateTime(t.workerConfirmedAt)}
                  {t.disputedMinutes > 0 && <b style={{ color: 'var(--red)' }}>；争议工时 {t.disputedMinutes} 分钟（暂扣 ¥{t.disputedDeduction ?? 0}）</b>}
                </div>
              )}
              {t.workerRejectReason && (
                <div className="small" style={{ color: 'var(--red)' }}>拒绝原因：{t.workerRejectReason}</div>
              )}
              <div className="small">
                到场补偿：{t.arrivalCompensation === 'REQUIRED'
                  ? <b style={{ color: 'var(--red)' }}>企业需付 ¥{t.arrivalCompensationAmount}</b>
                  : t.arrivalCompensation === 'WAIVED' ? '无需补偿（工人继续原岗位）' : '待判定'}
                {t.arrivalCompensationReason && <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{t.arrivalCompensationReason}</div>}
              </div>
            </div>
          ))}
        </div>

        <div>
          <div className="card">
            <h2>聊天记录</h2>
            <div className="chat col" style={{ maxHeight: 300 }}>
              {d.messages.map((m: any) => (
                <div key={m.id} className="chat-row other">
                  <div className="bubble">
                    <div className="meta">{m.senderName}（{m.senderRole === 'WORKER' ? '工人' : m.senderRole === 'SUPERVISOR' ? '主管' : '企业'}）· {fmtDateTime(m.createdAt)}</div>
                    {m.content}
                  </div>
                </div>
              ))}
              {d.messages.length === 0 && <div className="muted small">无聊天记录</div>}
            </div>
          </div>

          <div className="card">
            <h2>保险与结算</h2>
            {d.policy ? (
              <div className="kv">
                <span className="k">保单状态</span><span><StatusBadge status={d.policy.status} /></span>
                <span className="k">承保岗位</span><span>{d.policy.currentPosition || '原岗位'}{d.policy.originalCoverageWan ? `（原 ${d.policy.originalCoverageWan}万→现 ${d.policy.coverageWan}万）` : `（${d.policy.coverageWan}万）`}</span>
                <span className="k">生效时间</span><span>{d.policy.effectiveFrom ? fmtDateTime(d.policy.effectiveFrom) : '未生效'}</span>
                <span className="k">终止时间</span><span>{d.policy.effectiveTo ? fmtDateTime(d.policy.effectiveTo) : '—'}</span>
                <span className="k">岗位风险</span><span>L{d.policy.jobRiskLevel}</span>
              </div>
            ) : <div className="muted small">无保单</div>}
            <div className="fab-space" />
            {d.settlement ? (
              <div className="kv">
                <span className="k">结算岗位</span><span>{d.settlement.settledPosition || '原岗位'}</span>
                <span className="k">工时</span><span>{d.settlement.workMinutes} 分（迟到 {d.settlement.lateMinutes}，加班 {d.settlement.overtimeMinutes}）</span>
                <span className="k">基础工资</span><span>{fmtMoney(d.settlement.baseWage)}</span>
                <span className="k">加班费</span><span>+{fmtMoney(d.settlement.overtimePay)}</span>
                <span className="k">餐补</span><span>+{fmtMoney(d.settlement.mealAllowance)}</span>
                {Number(d.settlement.arrivalCompensation) > 0 && <><span className="k">到场补偿</span><span>+{fmtMoney(d.settlement.arrivalCompensation)}</span></>}
                <span className="k">迟到扣款</span><span className="money">-{fmtMoney(d.settlement.lateDeduction)}</span>
                {Number(d.settlement.disputedMinutes) > 0 && (
                  <><span className="k">争议工时</span><span style={{ color: 'var(--red)' }}>{d.settlement.disputedMinutes} 分暂扣 {fmtMoney(d.settlement.disputedDeduction)}</span></>
                )}
                <span className="k">应发工人</span><span className="money">{fmtMoney(d.settlement.workerPayable)}</span>
                <span className="k">结算状态</span><span><StatusBadge status={d.settlement.status} /></span>
              </div>
            ) : <div className="muted small">未生成结算</div>}
          </div>
        </div>
      </div>

      {a.status === 'OPEN' && (
        <div className="card">
          <h2>客服裁决</h2>
          <Field label="裁决依据（必填）">
            <textarea className="input" rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="结合签到轨迹、主管确认、现场照片、聊天记录说明判断依据" />
          </Field>
          <div className="row">
            <div style={{ minWidth: 180 }}>
              <Field label="补发金额（仅补发时生效）">
                <input className="input" type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
              </Field>
            </div>
          </div>
          <div className="row">
            <button className="btn btn-success" disabled={!note.trim()} onClick={() => decide('REISSUED')}>裁决补发 ¥{amount}</button>
            <button className="btn" disabled={!note.trim()} onClick={() => decide('UPHELD')}>维持扣款（工人败诉）</button>
            <button className="btn btn-warn" disabled={!note.trim()} onClick={() => decide('ARBITRATION')}>证据不足 · 升级仲裁</button>
          </div>
        </div>
      )}

      {a.status === 'ARBITRATION' && (
        <div className="card">
          <h2>仲裁终局裁决</h2>
          <Field label="仲裁裁决书">
            <textarea className="input" rows={4} value={award} onChange={(e) => setAward(e.target.value)} placeholder="仲裁事实认定与裁决结果" />
          </Field>
          <Field label="裁决补发金额（0 表示不补发）">
            <input className="input" type="number" value={awardAmount} onChange={(e) => setAwardAmount(Number(e.target.value))} />
          </Field>
          <button className="btn btn-warn" disabled={!award.trim()} onClick={arbitrate}>下达仲裁裁决</button>
        </div>
      )}

      {done && <Alert kind="info">该工单已结案，裁决记录不可更改。</Alert>}
    </div>
  );
}
