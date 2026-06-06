import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type LaraPageContainerProps = {
  children: ReactNode;
  className?: string;
};

export function LaraPageContainer({ children, className }: LaraPageContainerProps) {
  return (
    <div className={cn("mx-auto flex w-full max-w-[1600px] flex-col gap-6", className)}>
      {children}
    </div>
  );
}
