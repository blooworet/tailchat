declare module 'minio' {
  export interface BucketItemStat {
    size: number;
    metaData?: any;
    [key: string]: any;
  }
  export interface Client {
    getObject: (bucket: string, object: string) => Promise<NodeJS.ReadableStream>;
    statObject: (bucket: string, object: string) => Promise<BucketItemStat>;
    removeObject: (bucket: string, object: string) => Promise<void>;
  }
}
