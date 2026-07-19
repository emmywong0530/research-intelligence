import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, CircleHelp, X } from "lucide-react";
import { accessLabels, paperTypeLabels } from "./mockData";
import type { Paper, ProposalState } from "./types";

export function Button({
  children,
  variant = "secondary",
  icon,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  icon?: ReactNode;
}) {
  return (
    <button className={`button button-${variant} ${className}`.trim()} {...props}>
      {icon}
      {children}
    </button>
  );
}

export function Card({ children, className = "", as: Tag = "section" }: { children: ReactNode; className?: string; as?: "section" | "article" | "div" }) {
  return <Tag className={`card ${className}`.trim()}>{children}</Tag>;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-header-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {action ? <div className="page-header-action">{action}</div> : null}
    </div>
  );
}

export function StatusPill({ children, tone = "accent" }: { children: ReactNode; tone?: "accent" | "muted" | "warning" | "danger" }) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}

export function MetricCard({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="metric-card">
      <p className="label">{label}</p>
      <p className="metric-value">{value}</p>
      {note ? <p className="metric-note">{note}</p> : null}
    </Card>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

export function MatchRing({ value }: { value: number }) {
  return (
    <div className="match-ring" style={{ "--match": `${value}%` } as CSSProperties} aria-label={`${value}% match`}>
      <span>{value}%</span>
    </div>
  );
}

export function PaperMeta({ paper }: { paper: Paper }) {
  return (
    <div className="paper-meta">
      <StatusPill>{paperTypeLabels[paper.type]}</StatusPill>
      <span>{paper.year}</span>
      <span>{accessLabels[paper.access]}</span>
      <span>{paper.readingMinutes} min</span>
    </div>
  );
}

export function PaperCard({ paper, selected = false, onSelect, onReview }: { paper: Paper; selected?: boolean; onSelect?: () => void; onReview: () => void }) {
  return (
    <Card as="article" className={`paper-card ${selected ? "paper-card-selected" : ""}`}>
      <div className="paper-card-topline">
        <StatusPill>{paperTypeLabels[paper.type]}</StatusPill>
        <span className="label">{paper.year}</span>
      </div>
      <h3>{paper.title}</h3>
      <p className="paper-reason">{paper.reason}</p>
      <div className="paper-stats">
        <div><span className="label">Match</span><strong>{paper.match}%</strong></div>
        <div><span className="label">Access</span><strong>{accessLabels[paper.access]}</strong></div>
        <div><span className="label">Reading</span><strong>{paper.readingMinutes} min</strong></div>
      </div>
      <div className="card-actions">
        {onSelect ? <Button variant={selected ? "primary" : "secondary"} onClick={onSelect} aria-pressed={selected}>{selected ? "Selected" : "Select"}</Button> : null}
        <Button variant="primary" onClick={onReview}>Review</Button>
      </div>
    </Card>
  );
}

export function Modal({ open, title, eyebrow, onClose, children }: { open: boolean; title: string; eyebrow: string; onClose: () => void; children: ReactNode }) {
  if (!open) {
    return null;
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-heading">
          <div><p className="eyebrow">{eyebrow}</p><h2 id="modal-title">{title}</h2></div>
          <Button variant="ghost" className="icon-button" aria-label="Close modal" onClick={onClose} icon={<X size={18} />} />
        </div>
        {children}
      </section>
    </div>
  );
}

export function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="section-heading"><h2>{title}</h2>{action}</div>;
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return <div className="empty-state"><CircleHelp size={20} /><div><strong>{title}</strong><p>{description}</p></div></div>;
}

export function QuestRow({ label, done, number }: { label: string; done?: boolean; number: number }) {
  return <div className={`quest-row ${done ? "quest-done" : ""}`}><span className="quest-dot">{done ? <Check size={13} /> : number}</span><span>{label}</span></div>;
}

export function ProposalActions({ state, onChange }: { state: ProposalState; onChange: (state: ProposalState) => void }) {
  return (
    <div className="proposal-actions">
      <Button variant={state === "accepted" ? "primary" : "secondary"} onClick={() => onChange("accepted")}>Accept</Button>
      <Button variant={state === "modified" ? "primary" : "secondary"} onClick={() => onChange("modified")}>Modify</Button>
      <Button variant={state === "rejected" ? "primary" : "secondary"} onClick={() => onChange("rejected")}>Reject</Button>
    </div>
  );
}

export function FieldControls({ onPrevious, onNext }: { onPrevious: () => void; onNext: () => void }) {
  return <div className="field-controls"><Button variant="secondary" className="icon-button" aria-label="Previous paper" onClick={onPrevious} icon={<ChevronLeft size={18} />} /><Button variant="secondary" className="icon-button" aria-label="Next paper" onClick={onNext} icon={<ChevronRight size={18} />} /></div>;
}
