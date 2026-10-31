import * as React from "react";
import { cn } from "@/lib/utils";

interface LogomarkProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

export function Logomark({ size = 20, className, ...props }: LogomarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-primary shrink-0", className)}
      {...props}
    >
      {/* Handset arc */}
      <path
        d="M4 5C4 4.44772 4.44772 4 5 4H8.2C8.64183 4 9.02047 4.28825 9.14371 4.71264L9.8821 7.25624C10.0215 7.7369 9.80556 8.25206 9.36656 8.48704L7.8541 9.29656C8.89209 11.6033 10.7967 13.5079 13.1034 14.5459L13.9129 13.0334C14.1479 12.5944 14.6631 12.3785 15.1438 12.5179L17.6874 13.2563C18.1118 13.3795 18.4 13.7582 18.4 14.2V17.4C18.4 17.9523 17.9523 18.4 17.4 18.4C10.0039 18.4 4 12.3961 4 5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Soundwave bars emanating from handset */}
      <path
        d="M14 6V8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M17 4V10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M20 5.5V8.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
