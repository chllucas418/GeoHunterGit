import type { ReactNode } from 'react';

interface EmptyStateProps {
    icon?: string;
    title: string;
    description?: string;
    action?: {
        label: string;
        onClick: () => void;
        variant?: 'primary' | 'secondary';
    };
    children?: ReactNode;
}

export function EmptyState({
    icon = '📭',
    title,
    description,
    action,
    children
}: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center text-center p-8 max-w-md mx-auto">
            <div className="text-6xl mb-4 opacity-50">{icon}</div>

            <h3 className="text-xl font-heading font-bold text-cream mb-2">
                {title}
            </h3>

            {description && (
                <p className="text-stone text-sm mb-6 leading-relaxed">
                    {description}
                </p>
            )}

            {children}

            {action && (
                <button
                    onClick={action.onClick}
                    className={`mt-4 min-h-[44px] px-6 py-3 rounded-sm font-bold text-sm uppercase tracking-widest transition-all flex items-center gap-2
                        ${action.variant === 'secondary'
                            ? 'bg-brass/10 hover:bg-brass/20 text-cream border border-brass/20'
                            : 'bg-brass hover:bg-brass/90 text-charcoal border border-brass'
                        }`}
                >
                    {action.label}
                </button>
            )}
        </div>
    );
}