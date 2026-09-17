export type RuntimeStatus = {
  runtimeReady: boolean;
  shuttingDown: boolean;
};

const status: RuntimeStatus = {
  runtimeReady: false,
  shuttingDown: false,
};

export function getRuntimeStatus(): RuntimeStatus {
  return status;
}

export function isAcceptingTraffic(): boolean {
  return status.runtimeReady && !status.shuttingDown;
}

export function markRuntimeReady(): void {
  if (!status.shuttingDown) {
    status.runtimeReady = true;
  }
}

export function beginShutdownStatus(): void {
  status.shuttingDown = true;
  status.runtimeReady = false;
}

export function resetRuntimeStatusForTests(): void {
  status.runtimeReady = false;
  status.shuttingDown = false;
}
