import { cn } from "@/lib/utils";
import { maskSensitiveText } from "@/components/lara/sensitive";

export function LaraSensitiveText({
  value,
  className,
}: {
  value: string | null | undefined;
  className?: string;
}) {
  return <span className={cn("break-words", className)}>{maskSensitiveText(value)}</span>;
}
