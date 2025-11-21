import { regLoginAction } from '@capital/common';
import { IAMAction } from './IAMAction';

if (typeof process !== 'undefined' && (process as any).env && (process as any).env.NODE_ENV === 'development') {
  console.log('Plugin Identity and Access Management is loaded');
}

regLoginAction({
  name: 'plugin:com.msgbyte.iam/loginAction',
  component: IAMAction,
});
