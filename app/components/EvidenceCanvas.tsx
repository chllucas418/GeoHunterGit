import { useState, useRef, useEffect, type ReactNode } from "react";
import type { BoxCoordinates } from "~/types/shared";

interface EvidenceCanvasProps {
    imageUrl: string;
    onBoxChange: (box: BoxCoordinates | null) => void;
    disabled?: boolean;
    children?: ReactNode;
}

export function EvidenceCanvas({ imageUrl, onBoxChange, disabled = false, children }: EvidenceCanvasProps) {
    const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null);
    const [containerDimensions, setContainerDimensions] = useState<{ width: number; height: number } | null>(null);

    const containerRef = useRef<HTMLDivElement>(null); // The outer responsive container
    const imageContainerRef = useRef<HTMLDivElement>(null); // The inner aspect-ratio locked container

    const [isDrawing, setIsDrawing] = useState(false);
    const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
    const [drawRect, setDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null); // In Pixels

    // Observer to track container size
    useEffect(() => {
        if (!containerRef.current) return;

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setContainerDimensions({
                    width: entry.contentRect.width,
                    height: entry.contentRect.height
                });
            }
        });

        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const { naturalWidth, naturalHeight } = e.currentTarget;
        if (naturalHeight > 0) {
            setImageAspectRatio(naturalWidth / naturalHeight);
        }
    };

    // Determine styles for the inner container based on which dimension is limiting
    const getContainerStyle = () => {
        if (!imageAspectRatio || !containerDimensions) return { width: '100%', height: '100%' };

        const containerAspectRatio = containerDimensions.width / containerDimensions.height;

        if (containerAspectRatio > imageAspectRatio) {
            // Container is wider than image -> Height matches container, Width is auto (based on aspect)
            return {
                height: '100%',
                width: 'auto',
                aspectRatio: `${imageAspectRatio}`,
                maxWidth: '100%' // Ensure no overflow
            };
        } else {
            // Container is narrower than image -> Width matches container, Height is auto (based on aspect)
            return {
                width: '100%',
                height: 'auto',
                aspectRatio: `${imageAspectRatio}`,
                maxHeight: '100%' // Ensure no overflow
            };
        }
    };

    const getRelativeCoords = (e: React.MouseEvent | React.TouchEvent) => {
        if (!imageContainerRef.current) return { x: 0, y: 0, width: 0, height: 0 };
        const rect = imageContainerRef.current.getBoundingClientRect();

        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

        return {
            x: clientX - rect.left,
            y: clientY - rect.top,
            width: rect.width,
            height: rect.height
        };
    };

    const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
        if (disabled) return;
        // Prevent default only for mouse to avoid selecting text, but allow touch
        if (!('touches' in e)) {
            e.preventDefault();
        }

        const { x, y } = getRelativeCoords(e);
        setIsDrawing(true);
        setStartPoint({ x, y });
        setDrawRect({ x, y, w: 0, h: 0 });
        onBoxChange(null); // Reset
    };

    const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing || !startPoint || disabled) return;
        const { x, y, width, height } = getRelativeCoords(e);

        // Clamp to image bounds
        const clampedX = Math.max(0, Math.min(x, width));
        const clampedY = Math.max(0, Math.min(y, height));

        const newX = Math.min(startPoint.x, clampedX);
        const newY = Math.min(startPoint.y, clampedY);
        const newW = Math.abs(clampedX - startPoint.x);
        const newH = Math.abs(clampedY - startPoint.y);

        setDrawRect({ x: newX, y: newY, w: newW, h: newH });
    };

    const handleMouseUp = () => {
        if (!isDrawing || !drawRect || !imageContainerRef.current) return;
        setIsDrawing(false);

        // Convert to relative 1000-scale for backend
        const rect = imageContainerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            const relativeBox = {
                x: Math.round((drawRect.x / rect.width) * 1000),
                y: Math.round((drawRect.y / rect.height) * 1000),
                w: Math.round((drawRect.w / rect.width) * 1000),
                h: Math.round((drawRect.h / rect.height) * 1000)
            };

            // Filter tiny boxes
            if (relativeBox.w > 20 && relativeBox.h > 20) {
                onBoxChange(relativeBox);
            } else {
                setDrawRect(null); // Clear if too small
                onBoxChange(null);
            }
        }
    };

    return (
        <div
            className="w-full h-full bg-slate-900 flex items-center justify-center overflow-hidden"
            ref={containerRef}
        >
            {/* Inner Container: Locked to Image Aspect Ratio */}
            <div
                ref={imageContainerRef}
                className="relative select-none touch-none"
                style={getContainerStyle()}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleMouseDown}
                onTouchMove={handleMouseMove}
                onTouchEnd={handleMouseUp}
            >
                <img
                    src={imageUrl}
                    alt="Evidence"
                    className="w-full h-full object-contain pointer-events-none display-block"
                    draggable={false}
                    onLoad={handleImageLoad}
                />

                {/* Drawing Box (Transient) */}
                {drawRect && (
                    <div
                        className="absolute border-2 border-yellow-400 bg-yellow-400/20 z-50"
                        style={{
                            left: drawRect.x,
                            top: drawRect.y,
                            width: drawRect.w,
                            height: drawRect.h
                        }}
                    />
                )}

                {/* Result/Overlay Content (Anchored to this container) */}
                {children}

                {/* Instruction Overlay */}
                {!drawRect && !isDrawing && !disabled && (
                    <div className="absolute inset-x-0 bottom-4 flex justify-center pointer-events-none">
                        <p className="bg-black/60 text-white px-3 py-1 rounded text-xs font-mono uppercase tracking-widest backdrop-blur-md border border-white/10">
                            Draw Box to Scan
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
