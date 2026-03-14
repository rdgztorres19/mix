export type Session = 'PRE_MARKET' | 'THE_OPEN' | 'LATE_MORNING' | 'MIDDAY' | 'THE_CLOSE' | 'AFTER_HOURS';
export declare function getSession(etTime: string): Session;
export declare function getSessionFromTimestamp(tsMs: number): Session;
