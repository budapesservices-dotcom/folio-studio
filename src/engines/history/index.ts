export {
  DEFAULT_DELTA_HISTORY_LIMIT,
  applyProjectDelta,
  commitDeltaCoalesceGroup,
  computeProjectDelta,
  countDeltaTouchedNodes,
  createDeltaHistoryTimeline,
  isProjectDeltaEmpty,
  isProjectDeltaEntry,
  pushProjectDelta,
  redoProjectDelta,
  undoProjectDelta,
} from './deltaHistory';

export type {
  ComponentDeltaEntry,
  DeltaHistoryTimeline,
  DocumentNodesDelta,
  PageDeltaEntry,
  ProjectDelta,
} from './deltaHistory';
