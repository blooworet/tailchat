import { fetchConverseMemberAcks } from '../../model/converse';
import { getReduxStore } from '../store';
import { chatActions } from '../slices';

type StoreLike = ReturnType<typeof getReduxStore>;

const pending: Record<string, Promise<void>> = {};
const lastDoneAt: Record<string, number> = {};
const THROTTLE_MS = 800;

function maxId(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

export async function requestMemberAckSnapshot(converseId: string, storeArg?: StoreLike): Promise<void> {
  const store = storeArg || getReduxStore();
  if (!converseId) return;

  if (pending[converseId]) {
    return pending[converseId];
  }
  const now = Date.now();
  if (now - (lastDoneAt[converseId] || 0) < THROTTLE_MS) {
    return;
  }

  pending[converseId] = (async () => {
    try {
      const list = await fetchConverseMemberAcks(converseId);
      const snap: Record<string, string> = {};
      for (const it of list || []) {
        const uid = (it as any)?.userId ? String((it as any).userId) : '';
        const mid = (it as any)?.lastMessageId ? String((it as any).lastMessageId) : '';
        if (uid && mid) snap[uid] = mid;
      }
      const state = store.getState();
      const cur = (state as any)?.chat?.memberAcks?.[converseId] || {};
      const merged: Record<string, string> = { ...cur };
      for (const uid of Object.keys(snap)) {
        merged[uid] = maxId(cur[uid], snap[uid]) || snap[uid];
      }
      store.dispatch(chatActions.setConverseMemberAcks({ converseId, acks: merged }));
    } catch {}
    finally {
      lastDoneAt[converseId] = Date.now();
      delete pending[converseId];
    }
  })();

  return pending[converseId];
}
