import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../../api';
import { Alert, Badge, EventTypeTag, Spinner, StatusBadge, fmtDateTime, fmtMoney } from '../../components/ui';

export default function FieldBoard() {
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const timer = useRef<any>(null);

  const load = async (silent = false) => {
    try { setData(await get('/field/board')); } catch (e: any) { if (!silent) setError(e.message); }
  };
  useEffect(() => {
    load();
    timer.current = setInterval(() => load(true), 5000);
    return () => clearInterval(timer.current);
  }, []);

  const act = async (fn: () => Promise<any>, ok?: string) => {
    setError(''); setMsg('');
    try { const r = await fn(); setMsg(r?.message || ok || '操作成功'); await load(); }
    catch (e: any) { setError(e.message); }
  };

  if (!data) return <Spinner />;

  return (
    <div>
      <h1>现场工作台</h1>
      {msg && <Alert kind="ok">{msg}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      <div className="grid grid-2">
        <div className="card">
          <h2>待确认到岗（{data.pendingAttendance.length}）</h2>
          {data.pendingAttendance.length === 0 && <div className="muted small">暂无工人等待主管确认</div>}
          {data.pendingAttendance.map((e: any) => (
            <div key={e.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="row">
                <b>{e.workerName}</b>
                <Badge tone="blue">{e.jobTitle}</Badge>
                {e.strictConfirmation && <Badge tone="red">双人确认</Badge>}
                <div className="spacer" />
                <span className="small muted">{fmtDateTime(e.eventTime)}</span>
              </div>
              <div className="small" style={{ margin: '4px 0' }}>
                ✅定位 {e.distanceMeters}m · ✅人脸 {e.faceScore}分 · ✅二维码 {e.qrcodeToken}
                {e.supervisorConfirmed && ' · 第一确认已完成'}
              </div>
              <div className="row">
                <Link className="btn btn-sm" to={`/room/${e.assignmentId}`}>进入任务室</Link>
                <div className="spacer" />
                <button className="btn btn-success btn-sm"
                  onClick={() => act(() => post(`/attendance/${e.id}/supervisor-confirm`))}>
                  {e.supervisorConfirmed ? '第二名负责人复核' : '确认工人实际到岗'}
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>待处理作业事件（{data.pendingEvents.length}）</h2>
          {data.pendingEvents.length === 0 && <div className="muted small">暂无待处理事件</div>}
          {data.pendingEvents.map((e: any) => (
            <div key={e.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="row">
                <EventTypeTag type={e.type} />
                <b>{e.workerName}</b>
                <span className="small muted">{fmtDateTime(e.occurredAt)}</span>
              </div>
              <div className="small" style={{ margin: '4px 0' }}>{e.description}{e.minutes ? `（${e.minutes} 分钟）` : ''}</div>
              <div className="row">
                <Link className="btn btn-sm" to={`/room/${e.assignmentId}`}>任务室</Link>
                <div className="spacer" />
                <button className="btn btn-success btn-sm" onClick={() => act(() => post(`/events/${e.id}/review`, { approve: true, note: '现场确认属实' }))}>批准</button>
                <button className="btn btn-danger btn-sm" onClick={() => act(() => post(`/events/${e.id}/review`, { approve: false, note: '现场核实不属实' }))}>驳回</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>待工人确认岗位变更（{data.pendingPositionChanges.length}）</h2>
        {data.pendingPositionChanges.length === 0 && <div className="muted small">暂无待确认的岗位调换</div>}
        {data.pendingPositionChanges.map((p: any) => (
          <div key={p.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div className="row">
              <Badge tone="orange">待工人确认</Badge>
              <b>{p.workerName}</b>
              <Badge tone="blue">{p.jobTitle}</Badge>
              <div className="spacer" />
              <span className="small muted">发起于 {fmtDateTime(p.initiatedAt)}</span>
            </div>
            <div className="small" style={{ margin: '4px 0' }}>
              调至：{p.newPosition} · 强度 L{p.intensityLevel} · 风险 L{p.newRiskLevel} ·
              工资 {fmtMoney(p.originalDailyWage)} → {fmtMoney(p.newDailyWage)}
            </div>
            <div className="small" style={{ color: 'var(--orange)' }}>
              工人确认前不得安排其从事新岗位，否则该时段记为争议工时。
            </div>
            <div className="row">
              <Link className="btn btn-sm" to={`/room/${p.assignmentId}`}>进入任务室跟进</Link>
            </div>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>今日岗位签到二维码</h2>
        <div className="grid grid-3">
          {data.jobs.filter((j: any) => ['OPEN', 'FULL', 'IN_PROGRESS'].includes(j.status)).map((j: any) => (
            <QrTile key={j.id} job={j} />
          ))}
          {data.jobs.filter((j: any) => ['OPEN', 'FULL', 'IN_PROGRESS'].includes(j.status)).length === 0 && (
            <div className="muted small">当前没有进行中的岗位</div>
          )}
        </div>
      </div>

      <div className="card">
        <h2>最近签到记录</h2>
        <table>
          <thead><tr><th>工人</th><th>岗位</th><th>时间</th><th>四重校验</th><th>状态</th></tr></thead>
          <tbody>
            {data.recentAttendance.map((e: any) => (
              <tr key={e.id}>
                <td>{e.workerName}</td>
                <td className="small">{e.jobTitle}</td>
                <td className="small">{fmtDateTime(e.eventTime)}</td>
                <td className="small">
                  {e.locationPassed ? '定位✅' : '定位❌'} {e.facePassed ? '人脸✅' : '人脸❌'} {e.qrcodePassed ? '码✅' : '码❌'} {e.supervisorConfirmed ? '主管✅' : '主管⬜'}
                </td>
                <td>{e.allPassed ? <Badge tone="green">通过</Badge> : <StatusBadge status="PENDING" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QrTile({ job }: { job: any }) {
  const [qr, setQr] = useState<{ token: string } | null>(null);
  useEffect(() => {
    const tick = () => get(`/jobs/${job.id}/qrcode`).then(setQr).catch(() => {});
    tick();
    const t = setInterval(tick, 10000);
    return () => clearInterval(t);
  }, [job.id]);
  return (
    <div>
      <div className="small" style={{ marginBottom: 4 }}><b>{job.title}</b> {job.strictConfirmation && <Badge tone="red">双人</Badge>}</div>
      <div className="qr-box" style={{ fontSize: 20, letterSpacing: 4 }}>{qr?.token || '…'}</div>
    </div>
  );
}
