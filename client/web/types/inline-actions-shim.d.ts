// Temporary shims to satisfy type-checker in environments without full @types installed
declare module 'react';
declare module '@capital/common' {
  export const postRequest: any;
}
declare module 'tailchat-shared' {
  export const sharedEvent: any;
  export const showErrorToasts: any;
  export const showToasts: any;
  export const regSocketEventListener: any;
  export const getOrCreateSocket: any;
  export const createSocket: any;
}

declare var require: any;

declare namespace JSX {
  interface IntrinsicElements {
    [elemName: string]: any;
  }
}


