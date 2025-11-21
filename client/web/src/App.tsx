import React, { PropsWithChildren, Suspense, useEffect } from 'react';
import {
  BrowserRouter,
  HashRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';
import {
  getLanguage,
  parseUrlStr,
  sharedEvent,
  TcProvider,
  useAsync,
  useColorScheme,
  useGlobalConfigStore,
  useLanguage,
} from 'tailchat-shared';
import clsx from 'clsx';
import { Loadable } from './components/Loadable';
import { ConfigProvider as AntdProvider } from 'antd';
import { Helmet } from 'react-helmet';
import { useRecordMeasure } from './utils/measure-helper';
import { getPopupContainer, preventDefault } from './utils/dom-helper';
import { LoadingSpinner } from './components/LoadingSpinner';
import { pluginRootRoute } from './plugin/common';
import { PortalHost as FallbackPortalHost } from './components/Portal';
import isElectron from 'is-electron';
import { AppRouterApi } from './components/AppRouterApi';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { ErrorBoundary } from './components/ErrorBoundary';
import enUS from 'antd/es/locale/en_US';
import type { Locale } from 'antd/es/locale-provider';
import { useInjectTianjiScript } from './hooks/useInjectTianjiScript';
import { AnimationProvider } from 'tailchat-shared/animation';
import 'tailchat-shared/animation/animations.css';
import { ThemeProvider } from '../../shared/theme/ThemeProvider';
import TelegramDarkSpec from '../themes/telegram-dark';
import TelegramLightSpec from '../themes/telegram-light';

const AppRouter: any = isElectron() ? HashRouter : BrowserRouter;

const MainRoute = Loadable(
  () =>
    import(
      /* webpackChunkName: 'main' */ /* webpackPreload: true */ './routes/Main'
    )
);

const EntryRoute = Loadable(
  () =>
    import(
      /* webpackChunkName: 'entry' */ /* webpackPreload: true */ './routes/Entry'
    )
);

const PanelRoute = Loadable(() => import('./routes/Panel'));

const InviteRedirect = Loadable(
  () =>
    import(
      /* webpackChunkName: 'invite-redirect' */
      './routes/Invite/redirect'
    )
);

const UserProfileRoute = Loadable(
  () =>
    import(
      /* webpackChunkName: 'userprofile' */
      './routes/UserProfile'
    )
);

export const TcAntdProvider: React.FC<PropsWithChildren> = React.memo(
  (props) => {
    const { value: locale } = useAsync(async (): Promise<Locale> => {
      const language = getLanguage();

      if (language === 'zh-CN') {
        return import('antd/es/locale/zh_CN').then((m) => m.default);
      }

      return enUS;
    }, []);

    return (
      <AntdProvider getPopupContainer={getPopupContainer} locale={locale}>
        {props.children}
      </AntdProvider>
    );
  }
);
TcAntdProvider.displayName = 'TcAntdProvider';

const AppProvider: React.FC<PropsWithChildren> = React.memo((props) => {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <AppRouter>
        <TcProvider>
          <DndProvider backend={HTML5Backend}>
            <AnimationProvider>
              <TcAntdProvider>{props.children}</TcAntdProvider>
            </AnimationProvider>
          </DndProvider>
        </TcProvider>
      </AppRouter>
    </Suspense>
  );
});
AppProvider.displayName = 'AppProvider';

const AppContainer: React.FC<PropsWithChildren> = React.memo((props) => {
  const { isDarkMode, extraSchemeName } = useColorScheme();

  return (
    <div
      id="tailchat-app"
      className={clsx(
        'tailchat-app',
        'absolute inset-0 select-none overflow-hidden',
        {
          dark: isDarkMode,
        },
        extraSchemeName
      )}
      onContextMenu={preventDefault}
    >
      {props.children}
    </div>
  );
});
AppContainer.displayName = 'AppContainer';

const AppHeader: React.FC = React.memo(() => {
  const { language } = useLanguage();
  const { serverName, serverEntryImage } = useGlobalConfigStore((state) => ({
    serverName: state.serverName,
    serverEntryImage: state.serverEntryImage,
  }));

  return (
    <Helmet>
      <meta httpEquiv="Content-Language" content={language} />
      <title>{serverName}</title>

      {serverEntryImage && (
        <style type="text/css">
          {`
              #tailchat-app {
                --tc-background-image: url(${parseUrlStr(serverEntryImage)});
              }
            `}
        </style>
      )}
    </Helmet>
  );
});
AppHeader.displayName = 'AppHeader';

export const App: React.FC = React.memo(() => {
  useRecordMeasure('appRenderStart');

  useInjectTianjiScript();

  useEffect(() => {
    sharedEvent.emit('appLoaded');
  }, []);

  return (
    <AppProvider>
      <AppHeader />
      <ThemeProvider
        getThemeSpec={(scheme: string) => {
          try {
            if (typeof scheme === 'string') {
              // Preferred path: explicit telegram
              if (scheme.endsWith('+telegram')) {
                if (scheme.startsWith('dark')) return TelegramDarkSpec as any;
                if (scheme.startsWith('light')) return TelegramLightSpec as any;
                // auto or others => follow media
                const prefersDark = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : true;
                return prefersDark ? (TelegramDarkSpec as any) : (TelegramLightSpec as any);
              }

              // Fallback: map any non-telegram scheme to telegram dark/light
              if (scheme === 'dark') return TelegramDarkSpec as any;
              if (scheme === 'light') return TelegramLightSpec as any;
              if (scheme === 'auto') {
                const prefersDark = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : true;
                return prefersDark ? (TelegramDarkSpec as any) : (TelegramLightSpec as any);
              }

              // composite like dark+foo -> use base
              const [base] = scheme.split('+');
              if (base === 'dark') return TelegramDarkSpec as any;
              if (base === 'light') return TelegramLightSpec as any;
              // otherwise default dark
              return TelegramDarkSpec as any;
            }
          } catch {}
          // final fallback
          return TelegramDarkSpec as any;
        }}
      >
        <AppContainer>
          <AppRouterApi />
          <ErrorBoundary>
            <Routes>
              <Route
                path="/entry/*"
                element={
                  <FallbackPortalHost>
                    <EntryRoute />
                  </FallbackPortalHost>
                }
              />
              <Route path="/main/*" element={<MainRoute />} />
              <Route path="/panel/*" element={<PanelRoute />} />
              <Route path="/invite/:inviteCode" element={<InviteRedirect />} />
              <Route path="/login" element={<Navigate to="/entry/login" replace={true} />} />
              <Route path="/register" element={<Navigate to="/entry/register" replace={true} />} />
              <Route path="/guest" element={<Navigate to="/entry/guest" replace={true} />} />
              <Route
                path="/plugin/*"
                element={
                  <FallbackPortalHost>
                    <Routes>
                      {pluginRootRoute.map((r, i) => (
                        <Route
                          key={r.name}
                          path={r.path ?? `/fallback${i}`}
                          element={React.createElement(r.component)}
                        />
                      ))}
                    </Routes>
                  </FallbackPortalHost>
                }
              />
              <Route path="/:username" element={<UserProfileRoute />} />
              <Route path="/*" element={<Navigate to="/entry" replace={true} />} />
            </Routes>
          </ErrorBoundary>
        </AppContainer>
      </ThemeProvider>
    </AppProvider>
  );
});
App.displayName = 'App';