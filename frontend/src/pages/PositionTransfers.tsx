import { useState } from 'react';
import { post } from '../api';
import { Alert, Badge, Field, Modal, fmtDateTime, fmtMoney } from '../components/ui';
import { INDUSTRIES } from './industry';

type Act = (fn: () => Promise<any>, okMsg?: string) => Promise<any>;

function TransferStatus({ t }: { t: any }) {
  if (t.status === 'PENDING') return <Badge tone="orange">待工人确认</Badge>;
  if (t.status === 'CONFIRMED') return <Badge tone="green">工人已确认</Badge>;
  return <Badge tone="red">工人已拒绝</Badge>;
}

function WageDiff({ t }: { t: any }) {
  const diff = Number(t.newDailyWage) - Number(t.originalDailyWage);
  if (diff === 0) return <Badge tone="gray">工资持平</Badge>;
  return <Badge tone={diff > 0 ? 'green' : 'red'}>{diff > 0 ? `加薪 +${fmtMoney(diff)}/班` : `降薪 -${fmtMoney(Math.abs(diff))}/班`}</Badge>;
}

function CompareRow({ k, oldV, newV, changed }: { k: string; oldV: any; newV: any; changed?: boolean }) {
  return (
    <div className="row" style={{ padding: '6px 0', borderBottom: '1px dashed var(--line)' }}>
      <span className="muted small" style={{ minWidth: 72 }}>{k}</span>
      <span className="small">{oldV}</span>
      <span className="muted small">→</span>
      <b style={{ color: changed ? 'var(--orange)' : undefined }}>{newV}</b>
    </div>
  );
}

/* ---------- 主管发起岗位调换 ---------- */
function InitiateTransferCard({ room, busy, onAct }: { room: any; busy: boolean; onAct: Act }) {
  const job = room.job;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    newPosition: '重货搬运工',
    newIndustry: 'EXHIBITION',
    newWorkIntensity: '持续搬运 20~30kg 箱装重货、负重装卸车，劳动强度显著高于原分拣岗位，中间仅安排两次休息。',
    newRiskDescription: '重物砸伤、腰肌劳损、装卸车剐蹭风险；须戴手套穿劳保鞋，听从叉车指挥。',
    newDailyWage: Number(job.dailyWage) + 60,
    newOvertimeRate: Number(job.overtimeRate) + 10,
    newCoverageWan: Math.max(50, Number(job.insuranceCoverageWan)),
    wageDiffNote: '',
  });
  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}>岗位临时调换</h2>
        <div className="spacer" />
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => setOpen(true)}>
          发起岗位调换（工人到场后改派）
        </button>
      </div>
      <div className="small muted" style={{ marginTop: 6 }}>
        工人报名的是「{job.title}」，到场后如需改做其他岗位，必须由现场主管发起，书面说明新岗位的
        <b>工作强度、风险与工资差异</b>，经工人确认后保险范围与工时单才同步切换；未经确认的作业时段计为争议工时。
      </div>

      {open && (
        <Modal title="发起岗位临时调换确认" onClose={() => setOpen(false)}
          footer={
            <button className="btn btn-primary" disabled={busy} onClick={async () => {
              await onAct(() => post('/position-transfers', { assignmentId: room.assignment.id, ...form }));
              setOpen(false);
            }}>提交并通知工人确认</button>
          }>
          <Alert kind="warn">
            发起时间取平台服务器时间，并视为企业要求开始新岗位作业的时点；工人确认前已作业的时段将被标记为争议工时。
          </Alert>
          <Field label="新岗位名称">
            <input className="input" value={form.newPosition} onChange={(e) => set('newPosition', e.target.value)} />
          </Field>
          <Field label="新岗位行业类别（决定风险等级与保费费率）">
            <select className="input" value={form.newIndustry} onChange={(e) => set('newIndustry', e.target.value)}>
              {Object.values(INDUSTRIES).map((i) => (
                <option key={i.key} value={i.key}>{i.label}（基础风险 L{i.baseRiskLevel}）</option>
              ))}
            </select>
          </Field>
          <Field label="新工作强度说明（必填，工人确认前须知悉）">
            <textarea className="input" rows={2} value={form.newWorkIntensity} onChange={(e) => set('newWorkIntensity', e.target.value)} />
          </Field>
          <Field label="新岗位风险说明（必填）">
            <textarea className="input" rows={2} value={form.newRiskDescription} onChange={(e) => set('newRiskDescription', e.target.value)} />
          </Field>
          <div className="grid grid-3">
            <Field label="新日工资（元/班）">
              <input className="input" type="number" value={form.newDailyWage} onChange={(e) => set('newDailyWage', Number(e.target.value))} />
            </Field>
            <Field label="新加班费率（元/时）">
              <input className="input" type="number" value={form.newOvertimeRate} onChange={(e) => set('newOvertimeRate', Number(e.target.value))} />
            </Field>
            <Field label="新保险保额（万元）">
              <input className="input" type="number" value={form.newCoverageWan} onChange={(e) => set('newCoverageWan', Number(e.target.value))} />
            </Field>
          </div>
          <Field label="工资差异补充说明（可选）">
            <input className="input" value={form.wageDiffNote} onChange={(e) => set('wageDiffNote', e.target.value)}
              placeholder="如：含重货岗位津贴 60 元/班" />
          </Field>
        </Modal>
      )}
    </div>
  );
}

/* ---------- 工人确认/拒绝 ---------- */
function WorkerConfirmCard({ t, busy, onAct }: { t: any; busy: boolean; onAct: Act }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div className="card" style={{ borderColor: 'var(--orange)' }}>
      <div className="row">
        <Badge tone="orange">待你确认</Badge>
        <b>岗位临时调换通知</b>
        <div className="spacer" />
        <span className="small muted">主管 {t.initiatedByName} · {fmtDateTime(t.initiatedAt)}</span>
      </div>
      <Alert kind="warn">
        你报名的岗位是「{t.originalPosition}」，企业现场要求改做「{t.newPosition}」。请仔细核对新岗位的工作强度、风险与工资；
        <b>确认后保险范围与工时单立即按新岗位更新</b>；企业要求开始新岗位（{fmtDateTime(t.newWorkStartedAt)}）之后你尚未确认的作业时间，将被标记为争议工时。
      </Alert>
      <div className="grid grid-2" style={{ marginTop: 8 }}>
        <div>
          <div className="small muted">原岗位</div>
          <b>{t.originalPosition}</b>（{INDUSTRIES[t.originalIndustry]?.label || t.originalIndustry} · L{t.originalRiskLevel}）
        </div>
        <div>
          <div className="small muted">新岗位</div>
          <b>{t.newPosition}</b>（{INDUSTRIES[t.newIndustry]?.label || t.newIndustry} · L{t.newRiskLevel}）
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <div className="small"><b>工作强度：</b>{t.newWorkIntensity}</div>
        <div className="small" style={{ marginTop: 4 }}><b>风险点：</b>{t.newRiskDescription}</div>
      </div>
      <div style={{ marginTop: 8 }}>
        <CompareRow k="日工资" oldV={fmtMoney(t.originalDailyWage)} newV={fmtMoney(t.newDailyWage)}
          changed={Number(t.newDailyWage) !== Number(t.originalDailyWage)} />
        <CompareRow k="加班费率" oldV={`${fmtMoney(t.originalOvertimeRate)}/时`} newV={`${fmtMoney(t.newOvertimeRate)}/时`}
          changed={Number(t.newOvertimeRate) !== Number(t.originalOvertimeRate)} />
        <CompareRow k="保险保额" oldV={`${t.originalCoverageWan} 万元`} newV={`${t.newCoverageWan} 万元`}
          changed={Number(t.newCoverageWan) !== Number(t.originalCoverageWan)} />
        <div className="row" style={{ padding: '6px 0' }}>
          <span className="muted small" style={{ minWidth: 72 }}>工资差异</span>
          <WageDiff t={t} />
          {t.wageDiffNote && <span className="small muted">{t.wageDiffNote}</span>}
        </div>
      </div>
      {!rejecting ? (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn btn-danger" disabled={busy} onClick={() => setRejecting(true)}>拒绝调换</button>
          <div className="spacer" />
          <button className="btn btn-success" disabled={busy}
            onClick={() => onAct(() => post(`/position-transfers/${t.id}/confirm`))}>
            我已知悉强度与风险，确认新岗位
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <Field label="拒绝原因（将记录在案，并据此判定企业是否需支付到场补偿）">
            <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="如：腰部有旧伤无法搬运重货 / 降薪未经本人同意" />
          </Field>
          <div className="row">
            <button className="btn btn-sm" disabled={busy} onClick={() => setRejecting(false)}>取消</button>
            <div className="spacer" />
            <button className="btn btn-danger" disabled={busy || !reason.trim()}
              onClick={() => onAct(() => post(`/position-transfers/${t.id}/reject`, { reason }), '已记录拒绝原因')}>
              确认拒绝并提交
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- 单条调换记录（已确认/已拒绝/待处理的只读视图与后续操作） ---------- */
function TransferRecord({ t, isField, isWorker, busy, onAct }: {
  t: any; isField: boolean; isWorker: boolean; busy: boolean; onAct: Act;
}) {
  const [note, setNote] = useState('');
  const [openResolve, setOpenResolve] = useState(false);
  return (
    <div className="card" key={t.id}>
      <div className="row">
        <TransferStatus t={t} />
        <b>{t.originalPosition} → {t.newPosition}</b>
        <WageDiff t={t} />
        <div className="spacer" />
        <span className="small muted">{fmtDateTime(t.initiatedAt)}</span>
      </div>
      <div className="small" style={{ marginTop: 6 }}>
        {INDUSTRIES[t.originalIndustry]?.label} L{t.originalRiskLevel} → {INDUSTRIES[t.newIndustry]?.label} L{t.newRiskLevel}
        ；日工资 {fmtMoney(t.originalDailyWage)} → {fmtMoney(t.newDailyWage)}
        ；保额 {t.originalCoverageWan}万 → {t.newCoverageWan}万
      </div>
      <div className="small muted" style={{ marginTop: 4 }}>强度：{t.newWorkIntensity}</div>
      <div className="small muted">风险：{t.newRiskDescription}</div>

      {t.status === 'CONFIRMED' && (
        <>
          <Alert kind="ok">
            工人已于 {fmtDateTime(t.workerConfirmedAt)} 确认；保险范围与工时单已按新岗位同步更新{t.policyUpdated ? '（保单已切换承保岗位/保额）' : ''}。
          </Alert>
          {t.disputedMinutes > 0 && (
            <Alert kind="error">
              争议工时 {t.disputedMinutes} 分钟：企业 {fmtDateTime(t.newWorkStartedAt)} 起要求从事新岗位，工人 {fmtDateTime(t.workerConfirmedAt)} 才确认，
              该时段未经确认即作业，对应工资暂扣、不计入正常结算，需经申诉/仲裁裁决。
            </Alert>
          )}
        </>
      )}

      {t.status === 'REJECTED' && (
        <>
          <Alert kind="error">
            工人于 {fmtDateTime(t.workerRespondedAt)} 拒绝调换。原因：{t.workerRejectReason}
          </Alert>
          <div className="row" style={{ marginTop: 6 }}>
            <b>到场补偿判定：</b>
            {t.arrivalCompensation === 'REQUIRED'
              ? <Badge tone="red">企业需支付 {fmtMoney(t.arrivalCompensationAmount)}</Badge>
              : <Badge tone="green">无需补偿</Badge>}
            {t.compensationResolvedAt && <span className="small muted">主管复核于 {fmtDateTime(t.compensationResolvedAt)}</span>}
          </div>
          <div className="small muted" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{t.arrivalCompensationReason}</div>

          {isField && t.arrivalCompensation === 'REQUIRED' && !t.compensationResolvedAt && (
            <div style={{ marginTop: 8 }}>
              {!openResolve ? (
                <button className="btn btn-sm" onClick={() => setOpenResolve(true)}>主管复核：登记工人拒绝后的去向</button>
              ) : (
                <div>
                  <Field label="复核备注（可选）">
                    <input className="input" value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder="如：工人留下继续分拣至下班 / 工人已离场" />
                  </Field>
                  <div className="row">
                    <button className="btn btn-sm" onClick={() => setOpenResolve(false)}>取消</button>
                    <div className="spacer" />
                    <button className="btn btn-success btn-sm" disabled={busy}
                      onClick={() => onAct(() => post(`/position-transfers/${t.id}/compensation`, { continued: true, note }), '已改判无需补偿')}>
                      留下继续原岗位（改判无需补偿）
                    </button>
                    <button className="btn btn-danger btn-sm" disabled={busy}
                      onClick={() => onAct(() => post(`/position-transfers/${t.id}/compensation`, { continued: false, note }), '已确认需付到场补偿')}>
                      工人已离场（维持补偿）
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function PositionTransfersTab({ room, isWorker, isField, busy, onAct }: {
  room: any; isWorker: boolean; isField: boolean; busy: boolean; onAct: Act;
}) {
  const transfers: any[] = room.positionTransfers || [];
  const pending = transfers.find((t) => t.status === 'PENDING');
  const canInitiate = isField && ['CHECKED_IN', 'WORKING'].includes(room.assignment.status) && !pending;
  return (
    <>
      {canInitiate && <InitiateTransferCard room={room} busy={busy} onAct={onAct} />}
      {isWorker && pending && <WorkerConfirmCard t={pending} busy={busy} onAct={onAct} />}
      {isField && pending && (
        <div className="card">
          <div className="row">
            <Badge tone="orange">等待工人确认</Badge>
            <span className="small">已通知工人「{pending.newPosition}」调换单，工人确认前不得要求其按新岗位规则结算。</span>
          </div>
        </div>
      )}
      {transfers.length === 0 && !canInitiate && (
        <div className="card muted small">本任务暂无岗位调换记录。</div>
      )}
      {transfers.map((t) => (
        <TransferRecord key={t.id} t={t} isField={isField} isWorker={isWorker} busy={busy} onAct={onAct} />
      ))}
    </>
  );
}
