import type { LucideIcon } from "lucide-react";

interface IconProps {
  icon: LucideIcon;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function Icon({ icon: LucideComponent, size = 16, strokeWidth = 1.75, className }: IconProps) {
  return (
    <LucideComponent
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden="true"
      focusable="false"
    />
  );
}
