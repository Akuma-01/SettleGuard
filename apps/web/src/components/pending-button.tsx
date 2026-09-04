"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

type PendingButtonProps = ComponentProps<"button"> & { pendingLabel: string };

export function PendingButton({ children, pendingLabel, ...props }: PendingButtonProps) {
  const { pending } = useFormStatus();
  return <button {...props} type={props.type ?? "submit"} disabled={pending || props.disabled} aria-busy={pending}>{pending && <span className="button-spinner" aria-hidden="true" />}{pending ? pendingLabel : children}</button>;
}
