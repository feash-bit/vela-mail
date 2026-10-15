import { LoaderCircle } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { hueFor, initials } from "../../lib/format";
import { Tooltip } from "./Tooltip";
export { Kbd } from "./Kbd";
import s from "./ui.module.css";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: ReactNode;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = "secondary", size = "md", icon, loading, children, className, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx(s.btn, s[variant], size !== "md" && s[size], className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <LoaderCircle size={15} className={s.spinner} /> : icon}
      {children}
    </button>
  );
});

type IconBtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  keys?: string;
  active?: boolean;
  small?: boolean;
  tooltipSide?: "top" | "bottom";
};

export const IconButton = forwardRef<HTMLButtonElement, IconBtnProps>(function IconButton(
  { label, keys, active, small, children, className, tooltipSide, ...rest },
  ref,
) {
  return (
    <Tooltip label={label} keys={keys} side={tooltipSide}>
      <button
        ref={ref}
        aria-label={label}
        data-active={active ? "true" : undefined}
        className={cx(s.iconBtn, small && s.iconBtnSm, className)}
        {...rest}
      >
        {children}
      </button>
    </Tooltip>
  );
});

export function Avatar({ name, email, size = 32 }: { name: string; email: string; size?: number }) {
  return (
    <span
      className={s.avatar}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), ["--h" as string]: hueFor(email.toLowerCase()) } as CSSProperties}
      aria-hidden
    >
      {initials(name || email)}
    </span>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={checked} aria-label={label} className={s.switch} onClick={() => onChange(!checked)} />;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className={s.segmented} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} className={s.segment} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({ width, height = 10, style }: { width: number | string; height?: number; style?: CSSProperties }) {
  return <span className={s.skel} style={{ display: "block", width, height, ...style }} />;
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <LoaderCircle size={size} className={s.spinner} aria-label="Loading" />;
}

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cx(s.input, className)} spellCheck={false} {...rest} />;
});

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyInner}>
        <div className={s.emptyArt}>{icon}</div>
        <h3 className={s.emptyTitle}>{title}</h3>
        {body && <p className={s.emptyBody}>{body}</p>}
        {action && <div className={s.emptyAction}>{action}</div>}
      </div>
    </div>
  );
}

export { cx };
