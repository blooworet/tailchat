/* eslint-disable @typescript-eslint/ban-ts-comment */
import { useEffect, useLayoutEffect } from 'react';
import { Metric, onCLS, onFCP, onFID, onINP, onLCP, onTTFB } from 'web-vitals';

const records: Record<string, number> = {};
const vitals: Record<string, number> = {};

const handleVitalsCb = (metric: Metric) => {
  if (!vitals[metric.name]) {
    vitals[metric.name] = metric.value;
  }
};

// 只在浏览器环境中初始化web-vitals
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  try {
    onCLS(handleVitalsCb);
    onFCP(handleVitalsCb);
    onFID(handleVitalsCb);
    onINP(handleVitalsCb);
    onLCP(handleVitalsCb);
    onTTFB(handleVitalsCb);
  } catch (error) {
    console.warn('Failed to initialize web-vitals:', error);
  }
}

/**
 * 记录测量点
 * @param name 测量点唯一名
 */
export function recordMeasure(name: string) {
  // 只在浏览器环境中记录测量点
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return; // 非浏览器环境直接返回
  }

  if (!records[name]) {
    try {
      if (typeof performance !== 'undefined' && performance.now && performance.mark) {
        performance.mark(`tailchat:${name}`);
        records[name] = performance.now();
      } else {
        records[name] = Date.now();
      }
    } catch (error) {
      console.warn('Performance API failed:', error);
      records[name] = Date.now();
    }
  }
}

/**
 * 记录测量点(hook)
 * @param name 测量点唯一名
 */
export function useRecordMeasure(name: string) {
  useLayoutEffect(() => {
    recordMeasure(name);
  }, []);

  useEffect(() => {
    recordMeasure(name + 'Mounted');
  }, []);
}

export const measure = {
  getVitals: () => ({ ...vitals }),
  getRecord: () => ({ ...records }),
  getTimeUsage() {
    // 只在浏览器环境中获取性能数据
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return {};
    }

    try {
      const usage: Record<string, number> = {};
      
      if (typeof performance !== 'undefined' && performance.timing) {
        const t = performance.timing;
        Object.assign(usage, {
          dnsUsage: t.domainLookupEnd - t.domainLookupStart,
          tcpUsage: t.connectEnd - t.connectStart,
          requestUsage: t.responseEnd - t.responseStart,
          parseDOMUsage: t.domComplete - t.domInteractive,
          firstPaintTime: t.responseStart - t.navigationStart,
          domReadyTime: t.domContentLoadedEventEnd - t.navigationStart,
          onloadTime: t.loadEventEnd - t.navigationStart,
        });
      }
      
      // 检查内存信息
      const performanceWithMemory = performance as any;
      if (performanceWithMemory?.memory) {
        const memory = performanceWithMemory.memory;
        if (memory.usedJSHeapSize && memory.totalJSHeapSize) {
          usage.jsHeapRatio = memory.usedJSHeapSize / memory.totalJSHeapSize;
        }
      }
      
      return usage;
    } catch (error) {
      console.warn('Failed to get performance timing data:', error);
      return {};
    }
  },
};
