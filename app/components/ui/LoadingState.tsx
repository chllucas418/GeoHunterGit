interface LoadingStateProps {
    message?: string;
    size?: 'sm' | 'md' | 'lg';
    variant?: 'spinner' | 'dots' | 'bars';
}

export function LoadingState({
    message = "Loading...",
    size = 'md',
    variant = 'spinner'
}: LoadingStateProps) {
    const sizeClasses = {
        sm: 'w-6 h-6 border-2',
        md: 'w-10 h-10 border-3',
        lg: 'w-16 h-16 border-4'
    };

    const textSizes = {
        sm: 'text-xs',
        md: 'text-sm',
        lg: 'text-base'
    };

    if (variant === 'dots') {
        return (
            <div className="flex flex-col items-center justify-center gap-4">
                <div className="flex gap-2">
                    <span className="w-3 h-3 bg-brass rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-3 h-3 bg-brass rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-3 h-3 bg-brass rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                {message && (
                    <p className={`${textSizes[size]} text-stone font-mono tracking-wide`}>
                        {message}
                    </p>
                )}
            </div>
        );
    }

    if (variant === 'bars') {
        return (
            <div className="flex flex-col items-center justify-center gap-4">
                <div className="flex items-end gap-1 h-8">
                    <div className="w-2 bg-brass rounded animate-[bars_1s_ease-in-out_infinite]" style={{ height: '40%', animationDelay: '0ms' }} />
                    <div className="w-2 bg-brass rounded animate-[bars_1s_ease-in-out_infinite]" style={{ height: '70%', animationDelay: '150ms' }} />
                    <div className="w-2 bg-brass rounded animate-[bars_1s_ease-in-out_infinite]" style={{ height: '100%', animationDelay: '300ms' }} />
                    <div className="w-2 bg-brass rounded animate-[bars_1s_ease-in-out_infinite]" style={{ height: '60%', animationDelay: '450ms' }} />
                    <div className="w-2 bg-brass rounded animate-[bars_1s_ease-in-out_infinite]" style={{ height: '30%', animationDelay: '600ms' }} />
                </div>
                {message && (
                    <p className={`${textSizes[size]} text-stone font-mono tracking-wide`}>
                        {message}
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center justify-center gap-4">
            <div
                className={`${sizeClasses[size]} border-brass border-t-transparent rounded-full animate-spin`}
            />
            {message && (
                <p className={`${textSizes[size]} text-stone font-mono tracking-wide`}>
                    {message}
                </p>
            )}
        </div>
    );
}