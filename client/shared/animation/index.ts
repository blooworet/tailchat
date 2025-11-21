/**
 * Tailchat 动效系统导出
 */

// 核心类和类型
export {
  MessageAnimationManager,
  AnimationType,
  DefaultAnimations,
} from './MessageAnimationManager';

// React 组件
export {
  AnimationProvider,
  MessageAnimationWrapper,
  ButtonAnimationWrapper,
  LoadingAnimation,
  ErrorAnimation,
  useAnimationManager
} from './MessageAnimationWrapper';

// 样式文件需要在应用中导入
// import 'tailchat-shared/animation/animations.css';
