import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../api';
import { useAuth } from '../auth';
import {
  Alert, Badge, EventTypeTag, Field, Modal, Spinner, StatusBadge,
  fmtDateTime, fmtMoney,
} from '../components/ui';
import { INDUSTRIES } from './industry';

const EVENT_TYPES = [
  { key: 'OVERTIME', label: '临时加班' },
  { key: 'POSITION_CHANGE', label: '岗位调换' },
  { key: 'EARLY_LEAVE', label: '工人早退' },
  { key: 'EXTRA_CARRY', label: '额外搬运' },
  { key: 'INJURY', label: '工人受伤' },
  { key: 'WAGE_DISPUTE', label: '工资被扣争议' },
  { key: 'OTHER', label: '其他' },
];

export default function TaskRoom() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();
  const [room, setRoom] = useState<any>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const timer = useRef<any>(null);

  const load = async (silent = false) => {
    try {
      const r = await get(`/assignments/${id}/room`);
      setRoom(r);
    } catch (e: any) { if (!silent) setError(e.message); }
  };
  useEffect(() => {
    load();
    timer.current = setInterval(() => load(true), 5000);
    return () => clearInterval(timer.current);
  }, [id]);

  const act = async (fn: () => Promise<any>, okMsg?: string) => {
    setError(''); setMsg(''); setBusy(true);
    try {
      const r = await fn();
      if (r?.message) setMsg(r.message);
      else if (okMsg) setMsg(okMsg);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!room) return <Spinner />;

  const isWorker = user?.role === 'WORKER';
  const isField = user?.role === 'SUPERVISOR' || user?.role === 'ENTERPRISE';
  const a = room.assignment;
  const canCheckIn = a.status === 'ACCEPTED';
  const canCheckOut = ['WORKING', 'CHECKED_IN'].includes(a.status);

  return (
    <div>
      <button className="btn btn-sm" onClick={() => nav(-1)}>← 返回</button>
      <div className="fab-space" />
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="ok">{msg}</Alert>}

      <div className="card">
        <div className="row">
          <Badge tone="blue">{room.job.industryLabel}</Badge>
          <b style={{ fontSize: 16 }}>{room.job.title}</b>
          <div className="spacer" />
          <StatusBadge status={a.status} />
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          {room.enterprise.name} · 📍 {room.job.location} · 🕒 {fmtDateTime(room.job.startTime)} ~ {fmtDateTime(room.job.endTime)}
        </div>
        <div className="small" style={{ marginTop: 6 }}>
          工人：{room.worker.name}（{room.worker.phone}）· 现场主管：
          {room.supervisors.map((s: any) => s.name).join('、') || '未指派'}
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>考勤与保险</button>
        <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>作业事件 ({room.events.length})</button>
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>任务沟通 ({room.messages.length})</button>
        <button className={tab === 'settlement' ? 'active' : ''} onClick={() => setTab('settlement')}>日结结算</button>
      </div>

      {tab === 'overview' && (
        <>
          <InsuranceCard room={room} />

          <PositionChangePanel room={room} isWorker={isWorker} isField={isField} busy={busy} onAct={act} />

          {isWorker && (canCheckIn || canCheckOut) && (
            <CheckInPanel
              mode={canCheckIn ? 'in' : 'out'}
              job={room.job}
              busy={busy}
              onSubmit={(dto) => act(() => post(canCheckIn ? '/attendance/check-in' : '/attendance/check-out', { assignmentId: a.id, ...dto }))}
            />
          )}

          {isField && <SupervisorActions room={room} busy={busy} onAct={act} />}

          <div className="card">
            <h2>签到轨迹（四重校验）</h2>
            {room.attendance.length === 0 && <div className="muted small">暂无考勤记录</div>}
            <div className="timeline">
              {room.attendance.map((e: any) => (
                <div key={e.id} className="t-item">
                  <div className="row">
                    <b>{e.kind === 'CHECK_IN' ? '到岗签到' : '完工签退'}</b>
                    {e.allPassed ? <Badge tone="green">四重通过</Badge> : <Badge tone="orange">待确认/未通过</Badge>}
                    <span className="small muted">{fmtDateTime(e.eventTime)}</span>
                  </div>
                  <div className="small" style={{ marginTop: 4 }}>
                    {e.locationPassed ? '✅定位' : `❌定位(${e.distanceMeters}m)`} ·
                    {e.facePassed ? `✅人脸(${e.faceScore})` : '❌人脸'} ·
                    {e.qrcodePassed ? '✅二维码' : '❌二维码'} ·
                    {e.supervisorConfirmed ? `✅主管确认(#${e.confirmedBySupervisorId})` : '⬜主管确认'}
                    {room.job.strictConfirmation && (e.secondConfirmed ? ' · ✅双人复核' : ' · ⬜双人复核')}
                    {e.photoUrl && ' · 📷现场照片'}
                  </div>
                  {e.failReason && <div className="small" style={{ color: 'var(--orange)' }}>{e.failReason}</div>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'events' && (
        <EventsTab room={room} isWorker={isWorker} isField={isField} busy={busy} onAct={act} />
      )}

      {tab === 'chat' && <ChatTab room={room} onSent={load} />}

      {tab === 'settlement' && (
        <SettlementTab room={room} isWorker={isWorker} isField={isField} busy={busy} onAct={act} gotoAppeal={() => nav('/my/appeals')} />
      )}
    </div>
  );
}

/* ---------------- 保险 ---------------- */
function InsuranceCard({ room }: { room: any }) {
  const p = room.policy;
  return (
    <div className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}>保险保单</h2>
        <div className="spacer" />
        {p ? <StatusBadge status={p.status} /> : <Badge tone="gray">录取后生成</Badge>}
      </div>
      {p ? (
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          <div className="kv">
            <span className="k">产品</span><span>{p.insurerProduct}</span>
            <span className="k">保额</span><span>{p.coverageWan} 万元</span>
            <span className="k">保费</span><span>{fmtMoney(p.premium)}（企业承担）</span>
            <span className="k">岗位风险</span><span><Badge tone={p.jobRiskLevel >= 4 ? 'red' : 'orange'}>L{p.jobRiskLevel}</Badge></span>
          </div>
          <div className="kv">
            <span className="k">企业确认</span><span>{p.enterpriseConfirmed ? <Badge tone="green">已确认承保</Badge> : <Badge tone="orange">未确认</Badge>}</span>
            <span className="k">生效时间</span><span>{p.effectiveFrom ? fmtDateTime(p.effectiveFrom) : '待四重到岗校验通过后即时生效'}</span>
            <span className="k">终止时间</span><span>{p.effectiveTo ? fmtDateTime(p.effectiveTo) : '—'}</span>
            <span className="k">生效凭据</span><span>{p.activatedByAttendanceId ? `锚定签到记录 #${p.activatedByAttendanceId} 的服务器时间` : '—'}</span>
          </div>
        </div>
      ) : <div className="muted small">工人被录取后系统自动生成保单（待生效）。</div>}
      {p && p.status !== 'ACTIVE' && p.status !== 'EXPIRED' && (
        <Alert kind="warn">保险尚未生效：未完成「定位 + 人脸 + 二维码 + 主管确认」四重到岗校验前发生事故不在保障范围，且平台禁止事后补录。</Alert>
      )}
      {p && p.adjustedByPositionChangeId && (
        <Alert kind="ok">
          保险范围已随岗位调换确认同步更新（变更单 #{p.adjustedByPositionChangeId}，{fmtDateTime(p.adjustedAt)}）：
          当前 {p.insurerProduct} · 保额 {p.coverageWan} 万 · 风险 L{p.jobRiskLevel}。
        </Alert>
      )}
      {room.claim && (
        <Alert kind={room.claim.coveredAtOccurrence ? 'ok' : 'error'}>
          工伤理赔单：{room.claim.injuryDesc} — {room.claim.coveredAtOccurrence
            ? '事故时保险在保障期内' : '事故时保险未生效，不予赔付，且不可事后补录'}（{room.claim.status}）
        </Alert>
      )}
    </div>
  );
}

/* ---------------- 临时岗位调换确认 ---------------- */
const INTENSITY_OPTS = [
  { v: 2, label: 'L2 轻体力（如分拣、理货）' },
  { v: 3, label: 'L3 中等体力（如码拍、笼车）' },
  { v: 4, label: 'L4 重体力（如整箱搬运）' },
  { v: 5, label: 'L5 高强度负重（如重货/重物上楼）' },
];

function PositionChangePanel({ room, isWorker, isField, busy, onAct }: any) {
  const list: any[] = room.positionChanges || [];
  const active = room.activePositionChange;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    newPosition: '', newIndustryKey: '', intensityLevel: 4,
    intensityNote: '', riskNote: '', newDailyWage: Number(room.job.dailyWage),
  });
  const [respNote, setRespNote] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);

  const canPropose = isField && ['WORKING', 'CHECKED_IN'].includes(room.assignment.status)
    && !active && !room.confirmedPositionChange;

  const submit = async () => {
    const r = await onAct(() => post('/position-changes', {
      assignmentId: room.assignment.id,
      newPosition: form.newPosition,
      newIndustryKey: form.newIndustryKey || null,
      intensityLevel: Number(form.intensityLevel),
      intensityNote: form.intensityNote,
      riskNote: form.riskNote,
      newDailyWage: Number(form.newDailyWage),
    }));
    if (r?.request) setOpen(false);
    return r;
  };

  return (
    <div className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}>到场岗位调换确认</h2>
        <div className="spacer" />
        {canPropose && <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>现场主管发起岗位变更</button>}
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        到场后企业要求改做其他岗位时，须由现场主管发起并说明新工作强度、风险与工资差异，
        经工人确认后保险范围与工时单才会同步更新；工人未确认即开始新岗位作业的时段记为争议工时。
      </div>

      {active && (
        <div className="alert alert-warn" style={{ marginTop: 10 }}>
          <div className="row">
            <Badge tone="orange">待工人确认</Badge>
            <b>{active.newPosition}</b>
            <span className="small muted">发起于 {fmtDateTime(active.initiatedAt)}</span>
          </div>
          <div className="grid grid-2" style={{ marginTop: 8 }}>
            <div className="kv">
              <span className="k">工作强度</span><span><Badge tone={active.intensityLevel >= 4 ? 'red' : 'orange'}>L{active.intensityLevel}</Badge> {active.intensityNote}</span>
              <span className="k">岗位风险</span><span><Badge tone={active.newRiskLevel >= 4 ? 'red' : 'orange'}>L{active.newRiskLevel}</Badge> {active.riskNote}</span>
            </div>
            <div className="kv">
              <span className="k">日结工资</span>
              <span className="money">{fmtMoney(active.originalDailyWage)} → <b>{fmtMoney(active.newDailyWage)}</b>
                {' '}<Badge tone={Number(active.wageDiff) >= 0 ? 'green' : 'red'}>{Number(active.wageDiff) >= 0 ? '+' : ''}{fmtMoney(active.wageDiff)}</Badge></span>
              <span className="k">确认后保险</span><span>{active.newInsurerProduct} · 保额 {active.newCoverageWan} 万 · 保费 {fmtMoney(active.newPremium)}</span>
            </div>
          </div>
          {isWorker && room.assignment.status === 'WORKING' && (
            <Alert kind="warn">⚠️ 你尚未确认该调换。在确认前已开始新岗位作业的时段将被标记为争议工时，请尽快确认或拒绝。</Alert>
          )}
          {isWorker && (
            <>
              <Field label="确认/拒绝说明（必填）">
                <input className="input" value={respNote} onChange={(e) => setRespNote(e.target.value)}
                  placeholder="确认时填写知悉声明；拒绝时填写拒绝原因" />
              </Field>
              <div className="row">
                <button className="btn btn-success btn-sm" disabled={busy || !respNote.trim()}
                  onClick={() => onAct(() => post(`/position-changes/${active.id}/respond`, { accept: true, note: respNote }), '已确认，保险与工时单已同步更新')}>
                  我已知悉并确认接受
                </button>
                <button className="btn btn-danger btn-sm" disabled={busy || !respNote.trim()}
                  onClick={() => setRejectOpen(true)}>拒绝调换</button>
              </div>
            </>
          )}
          {isField && <div className="small muted">已发起，等待工人在工人端确认或拒绝。</div>}
        </div>
      )}

      {rejectOpen && active && (
        <Modal title="拒绝岗位调换" onClose={() => setRejectOpen(false)}
          footer={<button className="btn btn-danger" disabled={busy}
            onClick={async () => {
              const r = await onAct(() => post(`/position-changes/${active.id}/respond`, { accept: false, note: respNote }));
              if (r?.request) setRejectOpen(false);
              return r;
            }}>确认拒绝并提交原因</button>}>
          <Alert kind="warn">拒绝原因：{respNote || '（请在上方填写）'}</Alert>
          <div className="small muted">
            平台将据此判定企业是否仍需支付到场补偿：若你已实际到岗且新岗位降薪、强度/风险实质提高，企业须按原岗位日结工资 20% 支付到场补偿；拒绝后不会按新岗位规则结算。
          </div>
        </Modal>
      )}

      {list.filter((p) => p.status !== 'PROPOSED').map((p) => (
        <div key={p.id} className="alert alert-info" style={{ marginTop: 8 }}>
          <div className="row">
            <StatusBadge status={p.status} />
            <b>{p.newPosition}</b>
            <span className="small muted">{fmtDateTime(p.workerRespondedAt || p.initiatedAt)}</span>
          </div>
          <div className="small" style={{ marginTop: 4 }}>
            强度 L{p.intensityLevel} · 风险 L{p.newRiskLevel} · 工资 {fmtMoney(p.originalDailyWage)} → {fmtMoney(p.newDailyWage)}
          </div>
          {p.status === 'CONFIRMED' && (
            <div className="small" style={{ marginTop: 4 }}>
              ✅ 工人已确认。工资按 {fmtMoney(p.newDailyWage)} 结算，保险已同步为 {p.newInsurerProduct}（保额 {p.newCoverageWan} 万 / L{p.newRiskLevel}）。
            </div>
          )}
          {p.status === 'REJECTED' && (
            <div className="small" style={{ marginTop: 4 }}>
              ❌ 工人拒绝原因：{p.workerResponseNote}
              {p.appearanceCompensationRequired
                ? <span style={{ color: 'var(--red)' }}> ｜ 平台判定企业须支付到场补偿 <b className="money">{fmtMoney(p.appearanceCompensationAmount)}</b>，不按新岗位规则结算。</span>
                : <span className="muted"> ｜ 平台判定无需到场补偿。{p.appearanceCompensationNote}</span>}
            </div>
          )}
        </div>
      ))}

      {list.length === 0 && !canPropose && <div className="muted small" style={{ marginTop: 8 }}>本次任务暂无岗位调换记录。</div>}

      {open && (
        <Modal title="现场主管发起临时岗位变更" onClose={() => setOpen(false)}
          footer={<button className="btn btn-primary" disabled={busy} onClick={submit}>发起并通知工人确认</button>}>
          <Alert kind="warn">请如实填写新岗位与原岗位的差异，工人确认前保险范围与工时单不变更；不得在工人未确认时安排其从事新岗位。</Alert>
          <Field label="调换后的新岗位（如：重货搬运）">
            <input className="input" value={form.newPosition} onChange={(e) => setForm({ ...form, newPosition: e.target.value })} />
          </Field>
          <Field label="新岗位行业分类（默认沿用原行业）">
            <select className="input" value={form.newIndustryKey} onChange={(e) => setForm({ ...form, newIndustryKey: e.target.value })}>
              <option value="">沿用原行业（{room.job.industryLabel}）</option>
              {Object.values(INDUSTRIES).map((x: any) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </Field>
          <Field label="新工作强度等级">
            <select className="input" value={form.intensityLevel} onChange={(e) => setForm({ ...form, intensityLevel: Number(e.target.value) })}>
              {INTENSITY_OPTS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="工作强度说明（负重/频次/作业方式）">
            <textarea className="input" rows={2} value={form.intensityNote} onChange={(e) => setForm({ ...form, intensityNote: e.target.value })}
              placeholder="如：单件 30-50kg，持续搬卸，需弯腰负重，配护腰/手套" />
          </Field>
          <Field label="岗位风险与防护说明">
            <textarea className="input" rows={2} value={form.riskNote} onChange={(e) => setForm({ ...form, riskNote: e.target.value })}
              placeholder="如：砸伤/扭伤风险升高，企业配手套护腰并安排轮换" />
          </Field>
          <Field label="新岗位日结工资（元/班）">
            <input className="input" type="number" value={form.newDailyWage} onChange={(e) => setForm({ ...form, newDailyWage: Number(e.target.value) })} />
          </Field>
          <div className="small muted">系统将依据行业与强度自动核定新风险等级及保险保额/保费，工人确认后即时同步。</div>
        </Modal>
      )}
    </div>
  );
}

/* ---------------- 工人签到 ---------------- */
function CheckInPanel({ mode, job, busy, onSubmit }: { mode: 'in' | 'out'; job: any; busy: boolean; onSubmit: (dto: any) => void }) {
  const [lat, setLat] = useState(Number(job.lat));
  const [lng, setLng] = useState(Number(job.lng));
  const [token, setToken] = useState('');
  const [face, setFace] = useState(true);

  const locate = (far: boolean) => {
    if (far) { setLat(31.0); setLng(121.0); return; }
    if (!navigator.geolocation) { setLat(Number(job.lat)); setLng(Number(job.lng)); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLat(Number(pos.coords.latitude.toFixed(6))); setLng(Number(pos.coords.longitude.toFixed(6))); },
      () => { setLat(Number(job.lat)); setLng(Number(job.lng)); },
      { timeout: 4000 },
    );
  };

  return (
    <div className="card">
      <h2>{mode === 'in' ? '到岗签到' : '完工签退'}（四重校验）</h2>
      <div className="checklist">
        <div className={`ci ${Math.abs(lat - Number(job.lat)) < 0.001 ? 'pass' : 'fail'}`}>
          <span className="ico">{Math.abs(lat - Number(job.lat)) < 0.001 ? '✅' : '❌'}</span>
          <span><b>定位围栏</b>（签到点 300m 内）当前坐标 {lat.toFixed(4)}, {lng.toFixed(4)}</span>
        </div>
        <div className={`ci ${face ? 'pass' : 'fail'}`}><span className="ico">{face ? '✅' : '❌'}</span><span><b>人脸抓拍比对</b>（与人脸样本比对，演示模拟得分 ≥ 90）</span></div>
        <div className={`ci ${token ? 'pass' : 'fail'}`}><span className="ico">{token ? '✅' : '⬜'}</span><span><b>扫描现场动态二维码</b>（主管端每分钟轮换）</span></div>
        <div className="ci fail"><span className="ico">⬜</span><span><b>现场主管确认</b>（提交后由主管独立完成，不能自证）</span></div>
      </div>
      <div className="grid grid-2">
        <Field label="定位坐标">
          <div className="row">
            <input className="input" value={lat} onChange={(e) => setLat(Number(e.target.value))} />
            <input className="input" value={lng} onChange={(e) => setLng(Number(e.target.value))} />
          </div>
        </Field>
        <Field label="现场二维码口令">
          <input className="input" value={token} onChange={(e) => setToken(e.target.value)} placeholder="扫码或输入 8 位口令" />
        </Field>
      </div>
      <div className="row">
        <button className="btn btn-sm" onClick={() => locate(false)}>📍 获取我的定位</button>
        <button className="btn btn-sm" onClick={() => locate(true)}>🧪 模拟偏离签到点</button>
        <label className="row small"><input type="checkbox" checked={face} onChange={(e) => setFace(e.target.checked)} /> 人脸比对通过</label>
        <div className="spacer" />
        <button className="btn btn-primary" disabled={busy}
          onClick={() => onSubmit({ lat, lng, qrcodeToken: token, facePassed: face, photoUrl: `mock://photo-${Date.now()}` })}>
          {mode === 'in' ? '提交到岗签到' : '提交完工签退'}
        </button>
      </div>
    </div>
  );
}

/* ---------------- 主管现场操作 ---------------- */
function SupervisorActions({ room, busy, onAct }: { room: any; busy: boolean; onAct: any }) {
  const pending = room.attendance.filter((e: any) => !e.allPassed && e.locationPassed && e.facePassed && e.qrcodePassed);
  const accepted = room.assignment.status === 'ACCEPTED';
  return (
    <div className="card">
      <h2>现场主管工作台</h2>
      <QrCode jobId={room.job.id} />
      <div className="fab-space" />
      {pending.length === 0 && <div className="muted small">暂无等待确认的到岗签到</div>}
      {pending.map((e: any) => (
        <div key={e.id} className="alert alert-info row" style={{ marginBottom: 8 }}>
          <span>{room.worker.name} 已于 {fmtDateTime(e.eventTime)} 完成定位/人脸/二维码三要素
            {room.job.strictConfirmation && '（高风险岗位需双人确认）'}</span>
          <div className="spacer" />
          <button className="btn btn-success btn-sm" disabled={busy}
            onClick={() => onAct(() => post(`/attendance/${e.id}/supervisor-confirm`))}>
            {e.supervisorConfirmed ? '第二名负责人复核确认' : '确认工人到岗'}
          </button>
        </div>
      ))}
      {accepted && (
        <div className="row">
          <span className="small muted">工人尚未到岗</span>
          <div className="spacer" />
          <button className="btn btn-sm btn-danger" disabled={busy}
            onClick={() => onAct(() => post(`/assignments/${room.assignment.id}/no-show`), '已标记爽约，保单作废')}>
            开工 15 分钟未到岗 · 标记爽约
          </button>
        </div>
      )}
    </div>
  );
}

function QrCode({ jobId }: { jobId: number }) {
  const [qr, setQr] = useState<{ token: string; expireSeconds: number } | null>(null);
  useEffect(() => {
    const tick = () => get(`/jobs/${jobId}/qrcode`).then(setQr).catch(() => {});
    tick();
    const t = setInterval(tick, 10000);
    return () => clearInterval(t);
  }, [jobId]);
  return (
    <div>
      <div className="small muted" style={{ marginBottom: 6 }}>出示给工人扫描的动态签到口令（每 60 秒轮换，防代签）：</div>
      <div className="qr-box">{qr?.token || '…'}</div>
    </div>
  );
}

/* ---------------- 作业事件 ---------------- */
function EventsTab({ room, isWorker, isField, busy, onAct }: any) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState('OVERTIME');
  const [desc, setDesc] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [newPosition, setNewPosition] = useState('');
  const [claimAmount, setClaimAmount] = useState(5000);

  const submit = async () => {
    await onAct(() => post('/events', {
      assignmentId: room.assignment.id, type, description: desc,
      minutes: ['OVERTIME', 'EARLY_LEAVE', 'EXTRA_CARRY'].includes(type) ? Number(minutes) : undefined,
      newPosition: type === 'POSITION_CHANGE' ? newPosition : undefined,
      claimAmount: type === 'INJURY' ? Number(claimAmount) : undefined,
      lat: room.job.lat, lng: room.job.lng, photoUrl: `mock://event-${Date.now()}`,
    }), '事件已现场实时上报（服务器时间不可篡改）');
    setOpen(false); setDesc('');
  };

  return (
    <>
      {isWorker && ['WORKING', 'CHECKED_IN'].includes(room.assignment.status) && (
        <div className="card row">
          <b>作业过程发生情况？</b>
          <div className="spacer" />
          <button className="btn btn-primary" onClick={() => setOpen(true)}>现场实时上报事件</button>
        </div>
      )}
      <div className="card">
        <h2>事件记录（派单/考勤/保险/工时/结算同任务关联）</h2>
        {room.events.length === 0 && <div className="muted small">暂无事件</div>}
        {room.events.map((e: any) => (
          <div key={e.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="row">
              <EventTypeTag type={e.type} />
              <StatusBadge status={e.status} />
              <span className="small muted">{fmtDateTime(e.occurredAt)}</span>
              {e.minutes ? <span className="small">{e.minutes} 分钟</span> : null}
              {e.newPosition ? <span className="small">调至：{e.newPosition}</span> : null}
              <div className="spacer" />
              {isField && e.status === 'PENDING' && (
                <div className="row">
                  <button className="btn btn-success btn-sm" disabled={busy}
                    onClick={() => onAct(() => post(`/events/${e.id}/review`, { approve: true, note: '现场确认情况属实' }))}>批准</button>
                  <button className="btn btn-danger btn-sm" disabled={busy}
                    onClick={() => onAct(() => post(`/events/${e.id}/review`, { approve: false, note: '情况不属实' }))}>驳回</button>
                </div>
              )}
            </div>
            <div className="small" style={{ marginTop: 4 }}>{e.description} {e.photoUrl && '📷'}</div>
            {e.reviewNote && <div className="small muted">审核备注：{e.reviewNote}</div>}
          </div>
        ))}
      </div>

      {open && (
        <Modal title="现场实时上报事件" onClose={() => setOpen(false)}
          footer={<button className="btn btn-primary" onClick={submit}>立即上报</button>}>
          <Alert kind="warn">事件时间取平台服务器当前时间，必须现场实时上报；事后补录将被系统拒绝。</Alert>
          <Field label="事件类型">
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              {EVENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="情况描述">
            <textarea className="input" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="请描述现场情况" />
          </Field>
          {['OVERTIME', 'EARLY_LEAVE', 'EXTRA_CARRY'].includes(type) && (
            <Field label="时长（分钟）"><input className="input" type="number" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></Field>
          )}
          {type === 'POSITION_CHANGE' && (
            <Field label="调换后的新岗位"><input className="input" value={newPosition} onChange={(e) => setNewPosition(e.target.value)} /></Field>
          )}
          {type === 'INJURY' && (
            <>
              <Field label="预估理赔金额（元）"><input className="input" type="number" value={claimAmount} onChange={(e) => setClaimAmount(Number(e.target.value))} /></Field>
              <Alert kind="info">系统将即时判定事故时点保险是否在保障期内；未完成四重到岗校验的事故不能理赔。</Alert>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

/* ---------------- 聊天 ---------------- */
function ChatTab({ room, onSent }: any) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const send = async () => {
    if (!text.trim()) return;
    await post(`/assignments/${room.assignment.id}/messages`, { content: text });
    setText('');
    onSent();
  };
  return (
    <div className="card">
      <h2>任务沟通（客服裁决可调取）</h2>
      <div className="chat col">
        {room.messages.map((m: any) => (
          <div key={m.id} className={`chat-row ${m.senderId === user?.id ? 'me' : 'other'}`}>
            <div className="bubble">
              <div className="meta">{m.senderName} · {m.senderRole === 'WORKER' ? '工人' : m.senderRole === 'SUPERVISOR' ? '主管' : '企业'} · {fmtDateTime(m.createdAt)}</div>
              {m.content}
            </div>
          </div>
        ))}
        {room.messages.length === 0 && <div className="muted small">暂无消息</div>}
      </div>
      <div className="fab-space" />
      <div className="row">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="输入消息，与主管/企业沟通加班、扣款等事项…" />
        <button className="btn btn-primary" onClick={send}>发送</button>
      </div>
    </div>
  );
}

/* ---------------- 结算 ---------------- */
function SettlementTab({ room, isWorker, isField, busy, onAct, gotoAppeal }: any) {
  const s = room.settlement;
  const [appealOpen, setAppealOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState(0);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');

  const line = (k: string, v: any, cls = '') => (
    <div className="row" style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
      <span className="muted">{k}</span><div className="spacer" /><span className={cls}>{v}</span>
    </div>
  );

  return (
    <>
      <div className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>日结明细</h2>
          <div className="spacer" />
          {s && <StatusBadge status={s.status} />}
        </div>
        {!s ? (
          <Alert kind="info">完工签退后系统自动生成结算明细。</Alert>
        ) : (
          <>
            {line('有效工时', `${s.workMinutes} 分钟（迟到 ${s.lateMinutes} 分钟，加班 ${s.overtimeMinutes} 分钟）`)}
            {Number(s.disputedMinutes) > 0 && (
              <div className="row" style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
                <span style={{ color: 'var(--orange)' }}>争议工时（岗位调换未确认即作业）</span>
                <div className="spacer" /><span style={{ color: 'var(--orange)' }}>{s.disputedMinutes} 分钟（暂按原岗位标准计发，可申诉）</span>
              </div>
            )}
            {line('基础工资', fmtMoney(s.baseWage))}
            {Number(s.newPositionPay) > 0 && line('其中：原岗位时段工资', fmtMoney(s.oldPositionPay))}
            {Number(s.newPositionPay) > 0 && line('其中：新岗位时段工资', `+ ${fmtMoney(s.newPositionPay)}`, 'money-green')}
            {line('加班费', `+ ${fmtMoney(s.overtimePay)}`, 'money-green')}
            {line('额外搬运补贴', `+ ${fmtMoney(s.extraCarryPay)}`, 'money-green')}
            {line('餐补', `+ ${fmtMoney(s.mealAllowance)}`, 'money-green')}
            {Number(s.appearanceCompensation) > 0 && line('到场补偿（拒绝不合理调换）', `+ ${fmtMoney(s.appearanceCompensation)}`, 'money-green')}
            {line('迟到扣款', `- ${fmtMoney(s.lateDeduction)}`, s.lateDeduction > 0 ? '' : '')}
            {line('其他扣款', `- ${fmtMoney(s.otherDeduction)}`)}
            {s.deductionReason && <div className="small" style={{ color: 'var(--orange)' }}>扣款说明：{s.deductionReason}</div>}
            <div className="row" style={{ padding: '10px 0' }}>
              <b>工人应发合计</b><div className="spacer" /><span className="money" style={{ fontSize: 20 }}>{fmtMoney(s.workerPayable)}</span>
            </div>
            <div className="small muted">
              企业侧：保费 {fmtMoney(s.insurancePremium)} + 平台服务费 {fmtMoney(s.platformServiceFee)}，
              企业应付 {fmtMoney(s.enterpriseCharged)}（预付款抵扣 {fmtMoney(s.enterprisePrepaymentUsed)}）
            </div>
            <div className="fab-space" />
            <div className="row">
              {isWorker && (
                <button className="btn btn-warn" onClick={() => { setAppealOpen(true); setAmount(Math.max(0, Number(s.lateDeduction))); }}>
                  对工资有异议 · 发起申诉
                </button>
              )}
              {isField && s.status !== 'PAID' && s.status !== 'ADJUSTED' && (
                <button className="btn btn-success" disabled={busy}
                  onClick={() => onAct(() => post('/settlements/pay', { assignmentIds: [room.assignment.id] }), '日结工资已发放')}>
                  确认并发放日结
                </button>
              )}
              {isField && (
                <button className="btn" disabled={busy}
                  onClick={() => onAct(() => post(`/settlements/job/${room.job.id}/generate`), '已按最新工时/事件重算')}>
                  重算明细
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {['COMPLETED', 'LEFT_EARLY'].includes(room.assignment.status) && (
        <div className="card">
          <h2>{isWorker ? '评价企业' : '评价工人'}</h2>
          <div className="row">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} className="btn btn-sm" style={{ fontSize: 18, background: rating >= n ? '#fff7e0' : '#fff' }}
                onClick={() => setRating(n)}>⭐</button>
            ))}
            <span className="small muted">{rating} 分</span>
          </div>
          <div className="fab-space" />
          <textarea className="input" rows={2} placeholder="评价内容（可选）" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="fab-space" />
          <button className="btn btn-primary" disabled={busy}
            onClick={() => onAct(() => post(`/reviews/assignments/${room.assignment.id}`, { rating, comment }), '评价已提交')}>
            提交评价
          </button>
        </div>
      )}

      {appealOpen && (
        <Modal title="发起工资争议申诉" onClose={() => setAppealOpen(false)}
          footer={<button className="btn btn-warn" disabled={busy}
            onClick={() => onAct(async () => {
              const r = await post('/appeals', { assignmentId: room.assignment.id, reason, claimedAmount: Number(amount) });
              setAppealOpen(false);
              gotoAppeal();
              return r;
            })}>提交申诉</button>}>
          <Field label="申诉理由（客服将调取签到轨迹/主管确认/现场照片/聊天记录）">
            <textarea className="input" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label="诉求补发金额（元）"><input className="input" type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
        </Modal>
      )}
    </>
  );
}
