import { ReactNode } from 'react';

export const fmtMoney = (n: any) => `¥${Number(n || 0).toFixed(2)}`;
export const fmtDate = (d: any) => d ? new Date(d).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
export const fmtDateTime = (d: any) => d ? new Date(d).toLocaleString('zh-CN') : '-';
export const fmtPct = (n: any) => `${(Number(n || 0) * 100).toFixed(0)}%`;

export function Badge({ tone = 'gray', children }: { tone?: 'gray' | 'blue' | 'green' | 'orange' | 'red' | 'purple'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: any; text: string }> = {
    OPEN: { tone: 'blue', text: '招募中' },
    FULL: { tone: 'orange', text: '已报满' },
    IN_PROGRESS: { tone: 'green', text: '作业中' },
    COMPLETED: { tone: 'gray', text: '已结束' },
    CANCELLED: { tone: 'red', text: '已取消' },
    APPLIED: { tone: 'blue', text: '已报名' },
    ACCEPTED: { tone: 'green', text: '已录取' },
    REJECTED: { tone: 'red', text: '已拒绝/未录取' },
    CHECKED_IN: { tone: 'green', text: '已到岗' },
    WORKING: { tone: 'green', text: '作业中' },
    LEFT_EARLY: { tone: 'orange', text: '早退完工' },
    NO_SHOW: { tone: 'red', text: '爽约' },
    PENDING: { tone: 'orange', text: '待处理' },
    APPROVED: { tone: 'green', text: '已批准' },
    PROPOSED: { tone: 'orange', text: '待工人确认' },
    CONFIRMED: { tone: 'green', text: '工人已确认' },
    ACTIVE: { tone: 'green', text: '保障中' },
    EXPIRED: { tone: 'gray', text: '已终止' },
    VOID: { tone: 'red', text: '已作废' },
    DRAFT: { tone: 'orange', text: '待发放' },
    PAID: { tone: 'green', text: '已发放' },
    ADJUSTED: { tone: 'purple', text: '申诉调整' },
    REPORTED: { tone: 'orange', text: '已报案' },
    INVESTIGATING: { tone: 'blue', text: '调查中' },
    UPHELD: { tone: 'gray', text: '维持扣款' },
    REISSUED: { tone: 'green', text: '裁决补发' },
    ARBITRATION: { tone: 'purple', text: '仲裁中' },
    ARBITRATION_AWARD: { tone: 'purple', text: '仲裁结案' },
  };
  const m = map[status] || { tone: 'gray', text: status };
  return <Badge tone={m.tone}>{m.text}</Badge>;
}

export function RiskLevel({ level }: { level: number }) {
  const tone = level >= 4 ? 'red' : level >= 3 ? 'orange' : level === 2 ? 'blue' : 'green';
  return <Badge tone={tone as any}>风险 L{level}</Badge>;
}

export function EventTypeTag({ type }: { type: string }) {
  const map: Record<string, string> = {
    OVERTIME: '临时加班', POSITION_CHANGE: '岗位调换', EARLY_LEAVE: '工人早退',
    EXTRA_CARRY: '额外搬运', INJURY: '工人受伤', JOB_CANCELLED: '企业取消岗位',
    WAGE_DISPUTE: '工资争议', OTHER: '其他',
  };
  return <Badge tone={type === 'INJURY' ? 'red' : type === 'OVERTIME' || type === 'EXTRA_CARRY' ? 'orange' : 'purple'}>{map[type] || type}</Badge>;
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn btn-sm" onClick={onClose}>关闭</button>
        </div>
        <div className="fab-space" />
        {children}
        {footer && <><div className="fab-space" /><div className="row" style={{ justifyContent: 'flex-end' }}>{footer}</div></>}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'error' | 'ok' | 'info' | 'warn'; children: ReactNode }) {
  return <div className={`alert alert-${kind === 'ok' ? 'ok' : kind}`}>{children}</div>;
}

export function Spinner() {
  return <div className="muted" style={{ padding: 30, textAlign: 'center' }}>加载中…</div>;
}

export function Face({ name, size }: { name: string; size?: 'sm' }) {
  return <div className={`face-box ${size || ''}`}>{(name || '?').slice(0, 1)}</div>;
}
