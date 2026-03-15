import { useCallback, useRef } from 'react';

// Using a lightweight custom hook for audio to avoid heavy dependencies 
// and handle browser autoplay policies gracefully.
export function useSound(base64Audio: string, options = { volume: 0.5 }) {
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const play = useCallback(() => {
        try {
            if (!audioRef.current) {
                const audio = new Audio(base64Audio);
                audio.volume = options.volume;
                audioRef.current = audio;
            }
            
            // Reset to start if already playing
            audioRef.current.currentTime = 0;
            
            // Play returns a promise, catch it to prevent unhandled rejections
            // when browsers block autoplay before user interaction
            const playPromise = audioRef.current.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.log("Audio playback prevented by browser policy", error);
                });
            }
        } catch (e) {
            console.error("Failed to play sound", e);
        }
    }, [base64Audio, options.volume]);

    return [play];
}
