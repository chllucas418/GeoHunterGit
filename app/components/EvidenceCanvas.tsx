import { useState, useRef, useEffect } from "react";
import clsx from "clsx";
import type { BoxCoordinates } from "~/types/shared";

interface EvidenceCanvasProps {
    imageUrl: string;
    onBoxChange: (box: BoxCoordinates | null) => void;
    disabled?: boolean;
}

export function EvidenceCanvas({ imageUrl, onBoxChange, disabled = false }: EvidenceCanvasProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
    const [currentBox, setCurrentBox] = useState<BoxCoordinates | null>(null); // stored as pixels initially for display, convert to relative on submit? 
    // Requirement: "box [x,y,w,h]" for Gemini. Usually relative 0-1000 or 0-1 is better for resolution independence.
    // I will store relative coordinates (percent) internally or convert at end.
    // Let's store internal display box in Percent to handle resize.

    const [drawRect, setDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null); // In Pixels for drawing interaction

    const getRelativeCoords = (e: React.MouseEvent | React.TouchEvent) => {
        if (!containerRef.current) return { x: 0, y: 0, width: 0, height: 0 };
        const rect = containerRef.current.getBoundingClientRect();
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
        const { x, y } = getRelativeCoords(e);
        setIsDrawing(true);
        setStartPoint({ x, y });
        setDrawRect({ x, y, w: 0, h: 0 });
        onBoxChange(null); // Reset
    };

    const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing || !startPoint || disabled) return;
        const { x, y, width, height } = getRelativeCoords(e);

        // Clamp
        const clampedX = Math.max(0, Math.min(x, width));
        const clampedY = Math.max(0, Math.min(y, height));

        const newX = Math.min(startPoint.x, clampedX);
        const newY = Math.min(startPoint.y, clampedY);
        const newW = Math.abs(clampedX - startPoint.x);
        const newH = Math.abs(clampedY - startPoint.y);

        setDrawRect({ x: newX, y: newY, w: newW, h: newH });
    };

    const handleMouseUp = () => {
        if (!isDrawing || !drawRect || !containerRef.current) return;
        setIsDrawing(false);

        // Convert to relative % or 1000-scale for backend
        const rect = containerRef.current.getBoundingClientRect();
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
            className="relative w-full h-full bg-slate-100 overflow-hidden select-none touch-none"
            ref={containerRef}
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
                className="w-full h-full object-contain pointer-events-none"
                draggable={false}
            />

            {/* Overlay to darken area outside selection? Or just the box. */}
            {/* Box */}
            {drawRect && (
                <div
                    className="absolute border-2 border-yellow-400 bg-yellow-400/20"
                    style={{
                        left: drawRect.x,
                        top: drawRect.y,
                        width: drawRect.w,
                        height: drawRect.h
                    }}
                />
            )}

            {/* Instruction */}
            {!drawRect && !isDrawing && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <p className="bg-black/50 text-white px-3 py-1 rounded text-sm backdrop-blur-sm">
                        Draw box around visual evidence
                    </p>
                </div>
            )}
        </div>
    );
}
