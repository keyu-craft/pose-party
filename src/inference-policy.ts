export const INFERENCE_POLICY = { bodyIntervalMs: 40, headIntervalMs: 70, maxResultAgeMs: 250, warmupFrames: 3 };
export type FrameStage = 'ready' | 'play' | 'rest';
export interface FrameTicket { generation: number; revision: number; roundId: number; stage: FrameStage; capturedAt: number }
export function acceptsFrame(ticket: FrameTicket, current: { generation: number; revision: number; roundId: number; stage: FrameStage; visible: boolean; running: boolean }, now: number): boolean {
  return current.running && current.visible && ticket.generation === current.generation && ticket.revision === current.revision && ticket.roundId === current.roundId &&
    ticket.stage === current.stage && Number.isFinite(now) && now >= ticket.capturedAt && now - ticket.capturedAt <= INFERENCE_POLICY.maxResultAgeMs;
}
export function frameStage(phase: string): FrameStage { return phase === 'ready' ? 'ready' : phase === 'match' || phase === 'hold' ? 'play' : 'rest'; }
