import {
  constants as performanceConstants,
  PerformanceObserver,
  performance,
} from "node:perf_hooks";

interface GcCounters {
  readonly total: number;
  readonly durationMs: number;
  readonly major: number;
  readonly minor: number;
  readonly incremental: number;
  readonly weakCallback: number;
}

const emptyGcCounters = (): GcCounters => ({
  total: 0,
  durationMs: 0,
  major: 0,
  minor: 0,
  incremental: 0,
  weakCallback: 0,
});

const difference = (current: GcCounters, previous: GcCounters): GcCounters => ({
  total: current.total - previous.total,
  durationMs: current.durationMs - previous.durationMs,
  major: current.major - previous.major,
  minor: current.minor - previous.minor,
  incremental: current.incremental - previous.incremental,
  weakCallback: current.weakCallback - previous.weakCallback,
});

export interface RuntimeMetrics {
  readonly intervalMs: number;
  readonly cpuUserMs: number;
  readonly cpuSystemMs: number;
  readonly cpuPercent: number;
  readonly eventLoopUtilization: number;
  readonly eventLoopActiveMs: number;
  readonly eventLoopIdleMs: number;
  readonly rssMb: number;
  readonly heapUsedMb: number;
  readonly heapTotalMb: number;
  readonly externalMb: number;
  readonly arrayBuffersMb: number;
  readonly maxRssMb: number;
  readonly gc: GcCounters;
}

interface RuntimeMetricsCollector {
  readonly snapshot: () => RuntimeMetrics;
  readonly close: () => void;
}

const bytesToMb = (bytes: number): number => bytes / (1024 * 1024);
const gcKind = (entry: PerformanceEntry): number | undefined => {
  if (!("detail" in entry)) {return undefined;}
  const detail = entry.detail;
  if (
    detail === null ||
    typeof detail !== "object" ||
    !("kind" in detail) ||
    typeof detail.kind !== "number"
  ) {
    return undefined;
  }
  return detail.kind;
};

export const createRuntimeMetrics = (): RuntimeMetricsCollector => {
  let previousCpu = process.cpuUsage();
  let previousSampleAt = performance.now();
  let previousEventLoopUtilization = performance.eventLoopUtilization();
  let gcCounters = emptyGcCounters();
  let previousGcCounters = emptyGcCounters();

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const kind = gcKind(entry);
      const next = {
        ...gcCounters,
        total: gcCounters.total + 1,
        durationMs: gcCounters.durationMs + entry.duration,
      };

      if (kind === performanceConstants.NODE_PERFORMANCE_GC_MAJOR) {
        next.major += 1;
      } else if (kind === performanceConstants.NODE_PERFORMANCE_GC_MINOR) {
        next.minor += 1;
      } else if (kind === performanceConstants.NODE_PERFORMANCE_GC_INCREMENTAL) {
        next.incremental += 1;
      } else if (kind === performanceConstants.NODE_PERFORMANCE_GC_WEAKCB) {
        next.weakCallback += 1;
      }

      gcCounters = next;
    }
  });

  observer.observe({ entryTypes: ["gc"] });

  return {
    snapshot: () => {
      const now = performance.now();
      const intervalMs = Math.max(now - previousSampleAt, 0.001);
      const currentCpu = process.cpuUsage();
      const cpuUserMs = (currentCpu.user - previousCpu.user) / 1_000;
      const cpuSystemMs = (currentCpu.system - previousCpu.system) / 1_000;
      const currentEventLoopUtilization = performance.eventLoopUtilization();
      const eventLoop = performance.eventLoopUtilization(
        previousEventLoopUtilization,
      );
      const memory = process.memoryUsage();
      const resourceUsage = process.resourceUsage();
      const gc = difference(gcCounters, previousGcCounters);

      previousCpu = currentCpu;
      previousSampleAt = now;
      previousEventLoopUtilization = currentEventLoopUtilization;
      previousGcCounters = gcCounters;

      return {
        intervalMs,
        cpuUserMs,
        cpuSystemMs,
        cpuPercent: ((cpuUserMs + cpuSystemMs) / intervalMs) * 100,
        eventLoopUtilization: eventLoop.utilization,
        eventLoopActiveMs: eventLoop.active,
        eventLoopIdleMs: eventLoop.idle,
        rssMb: bytesToMb(memory.rss),
        heapUsedMb: bytesToMb(memory.heapUsed),
        heapTotalMb: bytesToMb(memory.heapTotal),
        externalMb: bytesToMb(memory.external),
        arrayBuffersMb: bytesToMb(memory.arrayBuffers),
        maxRssMb: resourceUsage.maxRSS / 1_024,
        gc,
      } satisfies RuntimeMetrics;
    },
    close: () => { observer.disconnect(); },
  };
};
