import type { ReactNode, ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "success" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

interface AtlasButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    children: ReactNode;
    icon?: string;
}

const variantClasses: Record<ButtonVariant, string> = {
    primary: "bg-brass hover:bg-brass/90 text-charcoal border border-brass/50 shadow-[0_0_15px_rgba(201,168,76,0.2)]",
    secondary: "bg-[#0a1210] hover:bg-[#0e1a14] text-cream border border-brass/20 hover:border-brass/40",
    danger: "bg-rust/10 hover:bg-rust/20 text-rust border border-rust/30 hover:border-rust/50",
    success: "bg-teal/10 hover:bg-teal/20 text-teal border border-teal/30 hover:border-teal/50",
    ghost: "bg-transparent hover:bg-brass/10 text-stone hover:text-cream border border-transparent"
};

const sizeClasses: Record<ButtonSize, string> = {
    sm: "px-3 py-1.5 text-[10px]",
    md: "px-5 py-2.5 text-sm",
    lg: "px-6 py-3 text-base"
};

export function AtlasButton({
    variant = "primary",
    size = "md",
    children,
    icon,
    className = "",
    disabled,
    ...props
}: AtlasButtonProps) {
    return (
        <button
            className={`
                font-mono font-bold uppercase tracking-widest
                rounded-sm transition-all duration-200
                flex items-center justify-center gap-2
                ${variantClasses[variant]}
                ${sizeClasses[size]}
                ${disabled ? "opacity-40 cursor-not-allowed" : "hover:scale-[1.02] active:scale-[0.98]"}
                ${className}
            `}
            disabled={disabled}
            {...props}
        >
            {icon && <span className="text-lg">{icon}</span>}
            {children}
        </button>
    );
}

// Specialized button variants for common use cases
export function PrimaryButton({ children, ...props }: Omit<AtlasButtonProps, "variant">) {
    return <AtlasButton variant="primary" {...props}>{children}</AtlasButton>;
}

export function SecondaryButton({ children, ...props }: Omit<AtlasButtonProps, "variant">) {
    return <AtlasButton variant="secondary" {...props}>{children}</AtlasButton>;
}

export function DangerButton({ children, ...props }: Omit<AtlasButtonProps, "variant">) {
    return <AtlasButton variant="danger" {...props}>{children}</AtlasButton>;
}