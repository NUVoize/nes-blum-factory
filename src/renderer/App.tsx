import { useEffect } from 'react';
import { DIRECTOR_IDS, type DirectorId } from '../core/project/proposal';
import { AppProvider, go, useApp, useHash, useRoute } from './app-context';
import { CartridgesScreen } from './screens/CartridgesScreen';
import { DirectorScreen } from './screens/DirectorScreen';
import { FirstScreen } from './screens/FirstScreen';
import { GalleryScreen } from './screens/GalleryScreen';
import { HelpScreen } from './screens/HelpScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { HubScreen } from './screens/HubScreen';
import { PlayScreen } from './screens/PlayScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { TitleScreen } from './screens/TitleScreen';
import { ToastStack } from './ui';

function Router() {
  const route = useRoute();
  const hash = useHash();
  const { settings } = useApp();

  // Escape goes back one level (keyboard navigation, PLAN §9.8).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (route.startsWith('director/') || route === 'history' || route === 'first') go('hub');
      else if (route === 'play') go(/rom=demo/.test(location.hash) ? 'title' : /rom=(sebring|legend)/.test(location.hash) ? 'cartridges' : 'hub');
      else if (route === 'cartridges' || route === 'gallery') go('title');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route]);

  if (!settings) return null;
  if (route.startsWith('director/')) {
    const id = route.slice('director/'.length) as DirectorId;
    if ((DIRECTOR_IDS as readonly string[]).includes(id)) return <DirectorScreen key={id} director={id} />;
  }
  switch (route) {
    case 'cartridges':
      return <CartridgesScreen />;
    case 'hub':
      return <HubScreen />;
    case 'settings':
      return <SettingsScreen />;
    case 'history':
      return <HistoryScreen />;
    case 'gallery':
      return <GalleryScreen />;
    case 'help':
      return <HelpScreen />;
    case 'first':
      return <FirstScreen />;
    case 'play':
      // `#/play?rom=demo` and `#/play?tune=1` are different sessions: a new hash starts a fresh emulator
      return <PlayScreen key={hash} />;
    default:
      return <TitleScreen />;
  }
}

export function App() {
  return (
    <AppProvider>
      <Router />
      <ToastStack />
    </AppProvider>
  );
}
