import { useEffect, useState, useRef, useCallback } from "react";
import type { ReactNode } from "react";

interface EvidenceCanvasProps {
    imageUrl: string;
    onBoxChange: (box: BoxCoordinates | null) => void;
    disabled?: boolean;
    hasDrawnBoxes?: boolean;
    guidedBox?: BoxCoordinates | null;
    children?: ReactNode;
}

export function EvidenceCanvas({ imageUrl, onBoxChange, disabled = false, hasDrawnBoxes = false, guidedBox = null, children }: EvidenceCanvasProps) {
    const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null);
    const [containerDimensions, setContainerDimensions] = useState<{ width: number; height: number } | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const imageContainerRef = useRef<HTMLDivElement>(null);

    const [isDrawing, setIsDrawing] = useState(false);
    const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
    const [drawRect, setDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

    const touchDebounceRef = useRef(false);
    const lastTouchTimeRef = useRef(0);

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

    useEffect(() => {
        const img = imageContainerRef.current?.querySelector('img');
        if (img && img.complete && img.naturalHeight > 0) {
            setImageAspectRatio(img.naturalWidth / img.naturalHeight);
        }
    }, [imageUrl]);

    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const { naturalWidth, naturalHeight } = e.currentTarget;
        if (naturalHeight > 0) {
            setImageAspectRatio(naturalWidth / naturalHeight);
        }
    };

    const getContainerStyle = () => {
        if (!imageAspectRatio || !containerDimensions) return { width: '100%', height: '100%' };

        const { width: cW, height: cH } = containerDimensions;
        const containerAspectRatio = cW / cH;

        if (containerAspectRatio > imageAspectRatio) {
            const targetHeight = cH;
            const targetWidth = targetHeight * imageAspectRatio;
            return { height: `${targetHeight}px`, width: `${targetWidth}px` };
        } else {
            const targetWidth = cW;
            const targetHeight = targetWidth / imageAspectRatio;
            return { width: `${targetWidth}px`, height: `${targetHeight}px` };
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

    const handlePointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
        if (disabled) return;

        const now = Date.now();
        if (now - lastTouchTimeRef.current < 300) return;
        lastTouchTimeRef.current = now;

        e.preventDefault();

        const { x, y } = getRelativeCoords(e);
        setIsDrawing(true);
        setStartPoint({ x, y });
        setDrawRect({ x, y, w: 0, h: 0 });
        onBoxChange(null);
    }, [disabled, onBoxChange]);

    const handleMouseDown = handlePointerDown;

    const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing || !startPoint || disabled) return;
        e.preventDefault();
        const { x, y, width, height } = getRelativeCoords(e);

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

        const rect = imageContainerRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
            const relativeBox = {
                x: Math.round((drawRect.x / rect.width) * 1000),
                y: Math.round((drawRect.y / rect.height) * 1000),
                w: Math.round((drawRect.w / rect.width) * 1000),
                h: Math.round((drawRect.h / rect.height) * 1000)
            };

            if (relativeBox.w > 20 && relativeBox.h > 20) {
                onBoxChange(relativeBox);
            } else {
                onBoxChange(null);
            }
            setDrawRect(null);
        }
    };

    return (
        <div
            className="w-full h-full bg-[#0e1a14] flex items-center justify-center overflow-hidden"
            ref={containerRef}
        >
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

                {/* Drawing Box — Brass/Amber tint */}
                {drawRect && (
                    <div
                        className="absolute border-2 border-brass bg-brass/15 z-50"
                        style={{
                            left: drawRect.x,
                            top: drawRect.y,
                            width: drawRect.w,
                            height: drawRect.h
                        }}
                    />
                )}

                {children}

                {/* Guided Box Overlay */}
                {!hasDrawnBoxes && guidedBox && (
                    <div
                        className="absolute border-2 border-dashed border-brass animate-pulse pointer-events-none z-40 bg-brass/10"
                        style={{
                            left: `${guidedBox.x / 10}%`,
                            top: `${guidedBox.y / 10}%`,
                            width: `${guidedBox.w / 10}%`,
                            height: `${guidedBox.h / 10}%`
                        }}
                    >
                        <div className="absolute -top-6 left-0 text-[10px] font-bold uppercase tracking-widest text-brass bg-[#0e1a14]/80 px-2 py-0.5 rounded">
                            Draw Here
                        </div>
                    </div>
                )}

                {/* Instruction Overlay */}
                {!drawRect && !isDrawing && !disabled && !hasDrawnBoxes && (
                    <div className="absolute inset-x-0 bottom-4 flex justify-center pointer-events-none">
                        <p className="bg-[#0e1a14]/80 text-stone-light px-3 py-1 rounded text-[10px] font-mono uppercase tracking-widest backdrop-blur-md border border-brass/20">
                            Draw Box to Scan
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}