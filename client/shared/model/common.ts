import { getOrCreateSocket } from '../api/socket';
import { buildCachedRequest } from '../cache/utils';

/**
 * 获取可用的微服务列表
 */
export const fetchAvailableServices = buildCachedRequest(
  'fetchAvailableServices',
  async (): Promise<string[]> => {
    const socket = await getOrCreateSocket();
    const res = await socket.request<{
      nodeID: string;
      cpu: unknown;
      memory: unknown;
      services: string[];
    }>('gateway.health');
    return Array.isArray(res?.services) ? res.services : [];
  }
);
