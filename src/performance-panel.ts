import { PerformanceRecorder, PROFILE_MODES } from './diagnostics.ts';
import type { ProfileContext, RunOutcome, RunReport, Stats } from './diagnostics.ts';
import { COPY } from './i18n.ts';
import type { Language, CopyKey } from './i18n.ts';
import { reasonLabel, TRACKING_REASONS } from './tracking-reasons.ts';

const STORAGE_KEY = 'pose-party-performance-v1';
const escape = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const numeric = (n: number | null | undefined) => n !== null && n !== undefined && Number.isFinite(n) ? n.toFixed(1) : '—';
const metric = (s: Stats | undefined) => s?.count ? `${numeric(s.mean)} / ${numeric(s.p95)}` : '—';

export class PerformanceTools {
  private current: PerformanceRecorder | null = null;
  private history: RunReport[] = [];
  private observer: PerformanceObserver | null = null;
  private videoCallback: number | null = null;
  private lastPresented: number | null = null;
  private storageFailed = false;
  private selected = '';
  private readonly dialog = document.createElement('dialog');

  constructor(private readonly video: HTMLVideoElement, private readonly language: () => Language, private readonly button: HTMLButtonElement) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
      if (Array.isArray(saved)) this.history = saved.filter((r): r is RunReport => {
        if (!r || r.schemaVersion !== 1 || typeof r.id !== 'string' || typeof r.startedAt !== 'string' || !Number.isFinite(r.elapsedMs) ||
          !['active', 'finished', 'stopped', 'cancelled', 'error', 'pagehide'].includes(r.outcome) ||
          !r.capabilities || typeof r.capabilities.longTasks !== 'boolean' || !r.delegates ||
          ![null, 'GPU', 'CPU'].includes(r.delegates.pose) || ![null, 'GPU', 'CPU'].includes(r.delegates.face) ||
          (r.camera && (!Number.isFinite(r.camera.width) || !Number.isFinite(r.camera.height))) ||
          !Array.isArray(r.events) || !Array.isArray(r.samples) || !Array.isArray(r.stages) ||
          !r.stages.every((s: { stage?: unknown; durationMs?: unknown }) => s && typeof s.stage === 'string' && Number.isFinite(s.durationMs))) return false;
        return PROFILE_MODES.every(mode => {
          const g = r.groups?.[mode];
          return g && [g.checks, g.frames, g.cameraFrames, g.slowFrames, g.longTasks].every(Number.isFinite) &&
            ['poseMs', 'faceMs', 'uiMs'].every(k => g[k] && [g[k].count, g[k].mean, g[k].p95].every(Number.isFinite));
        });
      }).slice(0, 3);
    } catch { this.storageFailed = true; }
    this.dialog.className = 'performance-dialog'; this.dialog.setAttribute('aria-labelledby', 'performance-title');
    document.body.append(this.dialog);
    button.addEventListener('click', () => {
      this.selected = this.current?.id ?? this.history[0]?.id ?? '';
      this.current?.event('report-open', performance.now()); this.render(); this.dialog.showModal();
    });
    this.dialog.addEventListener('click', event => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-perf-action]')?.dataset.perfAction;
      if (action === 'close') this.dialog.close();
      if (action === 'refresh') this.render();
      if (action === 'download') this.download();
    });
    this.dialog.addEventListener('change', event => {
      if ((event.target as HTMLElement).id === 'performance-runs') { this.selected = (event.target as HTMLSelectElement).value; this.render(); }
    });
    this.translate();
  }
  private text(key: CopyKey) { return COPY[this.language()][key]; }
  translate() {
    this.button.textContent = this.text('performance');
    if (this.dialog.open) this.render();
  }
  start(): PerformanceRecorder {
    if (this.current) this.stop('stopped');
    const capabilities = {
      longTasks: typeof PerformanceObserver !== 'undefined' && (PerformanceObserver.supportedEntryTypes?.includes('longtask') ?? false),
      videoFrameCallbacks: typeof this.video.requestVideoFrameCallback === 'function',
    };
    const run = new PerformanceRecorder(globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(36).slice(2)}`, new Date().toISOString(), performance.now(), {
      userAgent: navigator.userAgent, logicalProcessors: navigator.hardwareConcurrency ?? null,
      deviceMemoryGiB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      viewportWidth: innerWidth, viewportHeight: innerHeight, pixelRatio: devicePixelRatio,
      mediapipeVersion: '0.10.32',
      bodyInferenceIntervalMs: 40, headInferenceIntervalMs: 70,
    }, capabilities);
    this.current = run; run.visibility(!document.hidden, performance.now());
    if (capabilities.longTasks) {
      try {
        this.observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) run.longTask(entry.startTime, entry.duration);
        });
        this.observer.observe({ type: 'longtask', buffered: false });
      } catch { capabilities.longTasks = false; this.observer = null; }
    }
    return run;
  }
  context(context: ProfileContext, now: number) { this.current?.setContext(context, now, !document.hidden); }
  frame(now: number) { this.current?.frame(now); }
  visibility() { this.lastPresented = null; this.current?.visibility(!document.hidden, performance.now()); }
  ui(ms: number) { this.current?.ui(ms, performance.now()); }
  event(type: string, code?: string) { this.current?.event(type, performance.now(), undefined, code); }
  inference(sample: Parameters<PerformanceRecorder['inference']>[0]) { this.current?.inference(sample, performance.now()); }
  async time<T>(run: PerformanceRecorder, stage: string, operation: () => Promise<T>): Promise<T> {
    const start = performance.now(); run.event('startup-stage', start, undefined, stage);
    try { const result = await operation(); run.stage(stage, start, performance.now(), true); return result; }
    catch (error) { run.stage(stage, start, performance.now(), false); throw error; }
  }
  cameraReady() {
    const run = this.current; if (!run) return;
    const settings = (this.video.srcObject as MediaStream | null)?.getVideoTracks()[0]?.getSettings();
    run.setCamera(this.video.videoWidth, this.video.videoHeight, settings?.frameRate);
    this.lastPresented = null;
    if (typeof this.video.requestVideoFrameCallback !== 'function') return;
    const callback: VideoFrameRequestCallback = (_now, metadata) => {
      if (this.current !== run) return;
      const count = this.lastPresented === null ? 1 : Math.max(0, metadata.presentedFrames - this.lastPresented);
      run.videoFrames(count); this.lastPresented = metadata.presentedFrames;
      this.videoCallback = this.video.requestVideoFrameCallback(callback);
    };
    this.videoCallback = this.video.requestVideoFrameCallback(callback);
  }
  stop(outcome: Exclude<RunOutcome, 'active'>) {
    if (this.videoCallback !== null) { this.video.cancelVideoFrameCallback?.(this.videoCallback); this.videoCallback = null; }
    if (!this.current) return;
    for (const entry of this.observer?.takeRecords() ?? []) this.current.longTask(entry.startTime, entry.duration);
    this.observer?.disconnect(); this.observer = null;
    this.current.finish(outcome, performance.now());
    const report = this.current.snapshot(performance.now());
    this.history = [report, ...this.history.filter(r => r.id !== report.id)].slice(0, 3);
    this.current = null;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.history)); this.storageFailed = false; }
    catch { this.storageFailed = true; }
    if (this.dialog.open) this.render();
  }
  private reports() {
    const live = this.current?.snapshot(performance.now());
    return live ? [live, ...this.history] : this.history;
  }
  private chosen(): RunReport | undefined {
    const reports = this.reports();
    return reports.find(r => r.id === this.selected) ?? reports[0];
  }
  private outcome(outcome: RunOutcome) {
    const keys: Record<RunOutcome, CopyKey> = { active: 'perfActive', finished: 'perfFinished', stopped: 'perfStopped', cancelled: 'perfCancelled', error: 'perfError', pagehide: 'perfPagehide' };
    return this.text(keys[outcome] ?? 'perfStopped');
  }
  private render() {
    const reports = this.reports(), report = reports.find(r => r.id === this.selected) ?? reports[0];
    this.selected = report?.id ?? '';
    const t = (key: CopyKey) => escape(this.text(key));
    const modeKeys = { ready: 'perfReady', arms: 'perfArms', head: 'perfHead', transition: 'perfTransition' } as const;
    const rows = report ? (Object.keys(modeKeys) as (keyof typeof modeKeys)[]).map(mode => {
      const g = report.groups[mode];
      return `<tr><th scope="row">${t(modeKeys[mode])}<small>${g.checks} ${t('perfSamples')}</small></th><td>${g.visibleMs > 0 ? numeric(g.displayFps) : '—'}</td><td>${g.visibleMs > 0 ? numeric(g.cameraFps) : '—'}</td><td>${g.visibleMs > 0 ? numeric(g.checksPerSecond) : '—'}</td><td>${metric(g.poseMs)}</td><td>${metric(g.faceMs)}</td><td>${metric(g.uiMs)}</td><td>${g.slowFrames}</td></tr>`;
    }).join('') : '';
    const init = (name: string) => report ? report.stages.filter(s => s.stage.startsWith(name)).reduce((sum, s) => sum + s.durationMs, 0) : 0;
    const longTasks = report ? Object.values(report.groups).reduce((n, g) => n + g.longTasks, 0) : 0;
    const execution = report?.environment?.inferenceExecution;
    const failures: Record<string, number> = {};
    for (const mode of ['arms', 'head'] as const) {
      for (const [code, count] of Object.entries(report?.groups[mode].failureReasons ?? {})) {
        if (TRACKING_REASONS.has(code) && Number.isFinite(count) && count > 0) failures[code] = (failures[code] ?? 0) + count;
      }
    }
    const failureRows = Object.entries(failures).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([code, count]) => `<li><span>${escape(reasonLabel(code, this.language()))}</span><strong>${Math.round(count)}</strong></li>`).join('');
    this.dialog.innerHTML = `
      <header class="performance-header"><h2 id="performance-title">${t('performance')}</h2><button class="report-close" data-perf-action="close" aria-label="${t('perfClose')}">×</button></header>
      <p class="performance-intro">${t('perfPrivacy')}</p>
      ${report ? `<label class="run-label" for="performance-runs">${t('perfRun')}</label><select id="performance-runs"></select>
      <div class="performance-meta"><span>${t('perfBody')}: ${escape(report.delegates.pose ?? '—')} · ${t('perfFace')}: ${escape(report.delegates.face ?? '—')} · ${t('perfExecution')}: ${execution === 'worker' ? t('perfWorker') : execution === 'main-fallback' ? t('perfMain') : '—'}</span><span>${report.camera ? `${report.camera.width} × ${report.camera.height}` : '—'} · ${numeric(report.elapsedMs / 1000)}s</span></div>
      <div class="performance-table-wrap"><table><thead><tr><th>${t('perfMode')}</th><th>${t('perfDisplay')}</th><th>${t('perfCamera')}</th><th>${t('perfChecks')}</th><th>${t('perfBody')} ms</th><th>${t('perfFace')} ms</th><th>${t('perfUi')} ms</th><th>${t('perfStalls')}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="performance-note">${t('perfNote')}</p>
      <div class="performance-details"><span>${t('perfInit')}: ${t('perfBody')} ${numeric(init('pose-'))}ms · ${t('perfFace')} ${numeric(init('face-'))}ms</span><span>${t('perfLongTasks')}: ${report.capabilities.longTasks ? longTasks : t('perfUnsupported')}</span></div>
      <p class="performance-note">${t('perfTrace')}</p>` : `<p class="performance-empty">${t('perfEmpty')}</p>`}
      ${report ? `<details class="performance-failures"><summary>${t('perfIssues')}</summary><p class="performance-note">${t('perfIssueNote')}</p>${failureRows ? `<ul>${failureRows}</ul>` : `<p class="performance-note">${t('perfIssuesEmpty')}</p>`}</details>` : ''}
      ${this.storageFailed ? `<p class="performance-warning">${t('perfStorage')}</p>` : ''}
      <div class="performance-actions"><button class="secondary" data-perf-action="refresh">${t('perfRefresh')}</button><button class="primary" data-perf-action="download" ${report ? '' : 'disabled'}>${t('perfDownload')}</button></div>`;
    const select = this.dialog.querySelector<HTMLSelectElement>('#performance-runs');
    reports.forEach(r => {
      const option = document.createElement('option'); option.value = r.id;
      const date = new Date(r.startedAt);
      option.textContent = `${Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(this.language() === 'zh' ? 'zh-CN' : 'en-GB')} · ${this.outcome(r.outcome)}`;
      option.selected = r.id === this.selected; select?.append(option);
    });
  }
  private download() {
    const report = this.chosen(); if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `pose-party-performance-${report.startedAt.replace(/[^0-9T]/g, '-')}.json`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  dispose() { this.stop('pagehide'); this.dialog.remove(); }
}
