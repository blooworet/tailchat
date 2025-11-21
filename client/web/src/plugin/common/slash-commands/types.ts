export interface CommandDTO {
  command: string;
  description: string;
  usage?: string;
  examples?: string[];
  scope?: any;
}

export interface CommandSetDTO {
  appId: string;
  appName?: string;
  userId?: string;
  version?: number;
  etag?: string | null;
  notModified?: boolean;
  commands?: CommandDTO[];
}

export type ScopeKey = string;

export interface CacheEntry {
  version?: number;
  etag?: string | null;
  commands: CommandDTO[];
  ts: number;
}
