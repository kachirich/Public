import type { RequestState } from './transitions.js';

// Thrown when the requested transition is not in VALID_TRANSITIONS for the
// request's current state. Carries currentState so callers can answer with
// "here's where the request actually is" instead of acting.
export class IllegalTransitionError extends Error {
  constructor(
    readonly requestId: string,
    readonly currentState: RequestState,
    readonly attemptedState: RequestState,
  ) {
    super(`Illegal transition for request ${requestId}: ${currentState} -> ${attemptedState}`);
    this.name = 'IllegalTransitionError';
  }
}

// Thrown when the caller supplied expectedVersion and the row moved on
// between their read and this transition.
export class VersionConflictError extends Error {
  constructor(
    readonly requestId: string,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(`Version conflict for request ${requestId}: expected ${expectedVersion}, found ${actualVersion}`);
    this.name = 'VersionConflictError';
  }
}

export class RequestNotFoundError extends Error {
  constructor(readonly requestId: string) {
    super(`Request not found: ${requestId}`);
    this.name = 'RequestNotFoundError';
  }
}
