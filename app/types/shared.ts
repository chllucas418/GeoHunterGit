export interface User {
    uid: string;
    displayName: string | null;
    currentElo: number;
    totalGames: number;
    accuracyAvg: number;
}

export interface Location {
    id: string;
    imageUrl: string;
    geoPoint: {
        lat: number;
        lng: number;
    };
    difficultyRating: number; // 1-10
    qualityScore: number;    // 1-100
    verifiedByGemini: boolean;
}

export interface GameSession {
    userId: string;
    locationId: string;
    userGuessCoords: {
        lat: number;
        lng: number;
    } | null;
    evidenceBoxCoords: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    } | null;
    score: number;
    aiFeedback: {
        validity: number;
        comment?: string;
    } | null;
    timestamp: number;
}

export type BoxCoordinates = {
    x: number;
    y: number;
    w: number;
    h: number;
};
