import type { NativeChangeSetDraft, NativeCommandSource } from '../core/commands/types';

export interface NativeCommandCommitAuthorization {
  readonly baseSnapshot: object;
  readonly candidateState: object;
  readonly changeDraft: NativeChangeSetDraft;
  readonly changeSource: NativeCommandSource;
}

const authorizations = new WeakMap<object, NativeCommandCommitAuthorization>();

export function registerNativeCommandCommitAuthorization(
  preparation: object,
  authorization: NativeCommandCommitAuthorization,
): void {
  authorizations.set(preparation, authorization);
}

export function getNativeCommandCommitAuthorization(
  preparation: object,
): NativeCommandCommitAuthorization | undefined {
  return authorizations.get(preparation);
}
