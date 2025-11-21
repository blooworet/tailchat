import 'antd/dist/antd.css';
import './antd/index.less';
import './tailwind.less';
import './global.less';
import './components/audio.less';

// 显式控制组件样式导入顺序，避免webpack chunk分包时的CSS顺序冲突
import '../components/PillTabs.less';
import '../components/SplitPanel.less';
import '../components/modals/CreateGroupInvite/CreateInviteCode.module.less';
