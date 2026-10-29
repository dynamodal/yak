export interface Run { name: string; label: string; [key: string]: unknown }
export function durationOf(label: string, durations: Record<string, number>): number;
export function longestFirst<T extends { label: string }>(runs: T[], durations: Record<string, number>): T[];
export function shardOf<T extends { label: string }>(runs: T[], durations: Record<string, number>, index: number, count: number): T[];
export function parseShard(text: string | undefined): { index: number; count: number };
