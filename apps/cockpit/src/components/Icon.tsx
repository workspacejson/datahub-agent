import type { LucideIcon } from "lucide-react";

interface IconProps {
  icon: LucideIcon;
  size?: number;
  className?: string;
}

export function Icon({ icon: LucideComponent, size = 16, className }: IconProps) {
  return (
    <LucideComponent
      width={size}
      height={size}
      strokeWidth={1.75}
      className={className}
      aria-hidden="true"
      focusable="false"
    />
  );
}
