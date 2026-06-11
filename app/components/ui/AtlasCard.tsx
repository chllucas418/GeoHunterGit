import type { ReactNode } from "react";

interface AtlasCardProps {
    children: ReactNode;
    className?: string;
    variant?: "default" | "highlighted" | "bordered";
}

export function AtlasCard({ children, className = "", variant = "default" }: AtlasCardProps) {
    const baseClasses = "p-6 bg-[#0a1210] rounded-sm";

    const variantClasses = {
        default: "border border-brass/10",
        highlighted: "border border-brass/30 shadow-[0_0_20px_rgba(201,168,76,0.1)]",
        bordered: "border border-teal/30"
    };

    return (
        <div className={`${baseClasses} ${variantClasses[variant]} ${className}`}>
            {children}
        </div>
    );
}