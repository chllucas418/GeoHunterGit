import { Link } from "react-router";
import type { ReactNode } from "react";

interface AdminHeaderProps {
    title: string;
    subtitle?: string;
    backTo?: string;
    backLabel?: string;
    actions?: ReactNode;
}

export function AdminHeader({ title, subtitle, backTo, backLabel = "← Back", actions }: AdminHeaderProps) {
    return (
        <header className="sticky top-0 z-50 bg-[#0e1a14]/95 backdrop-blur-xl border-b border-brass/10">
            <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    {backTo && (
                        <>
                            <Link
                                to={backTo}
                                className="text-sm text-teal hover:text-cream transition-colors flex items-center gap-2 font-mono uppercase tracking-widest"
                            >
                                {backLabel}
                            </Link>
                            <span className="text-brass/30">|</span>
                        </>
                    )}
                    <div>
                        <h1 className="font-heading text-xl font-black text-cream">{title}</h1>
                        {subtitle && (
                            <p className="text-[10px] font-mono text-stone/50 uppercase tracking-widest mt-1">
                                {subtitle}
                            </p>
                        )}
                    </div>
                </div>
                {actions && <div className="flex items-center gap-3">{actions}</div>}
            </div>
        </header>
    );
}