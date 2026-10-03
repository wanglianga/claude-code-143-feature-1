import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get } from '../../api';
import { Badge, Spinner, StatusBadge, fmtDate, fmtMoney } from '../../components/ui';

export default function MyTasks() {
  const [list, setList] = useState<any[]>([]);
  const [pendingTransferIds, setPendingTransferIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([get('/my/applications'), get('/position-transfers/mine/pending').catch(() => [])])
      .then(([apps, pending]) => {
        setList(apps);
        setPendingTransferIds(new Set((pending as any[]).map((t) => t.assignmentId)));
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <div>
      <h1>我的任务</h1>
      {list.length === 0 ? (
        <div className="card muted">还没有报名记录，去 <Link to="/jobs">岗位大厅</Link> 看看吧</div>
      ) : (
        <div className="col">
          {list.map((a) => (
            <div key={a.id} className="card">
              <div className="row">
                <Badge tone="blue">{a.job.industryLabel}</Badge>
                <b>{a.job.title}</b>
                {pendingTransferIds.has(a.id) && <Badge tone="orange">⚠️ 岗位调换待确认</Badge>}
                <div className="spacer" />
                <StatusBadge status={a.status} />
              </div>
              <div className="small muted" style={{ margin: '6px 0' }}>
                {a.job.enterpriseName} · 📍 {a.job.location} · 🕒 {fmtDate(a.job.startTime)}
              </div>
              <div className="row">
                {a.settlement ? (
                  <span className="small">日结应发 <b className={Number(a.settlement.workerPayable) > 0 ? 'money-green' : ''}>{fmtMoney(a.settlement.workerPayable)}</b>
                    <StatusBadge status={a.settlement.status} /></span>
                ) : (
                  <span className="small muted">日结单待完工后生成</span>
                )}
                <div className="spacer" />
                {['ACCEPTED', 'CHECKED_IN', 'WORKING', 'COMPLETED', 'LEFT_EARLY'].includes(a.status) && (
                  <Link className="btn btn-primary btn-sm" to={`/room/${a.id}`}>进入任务室 →</Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
