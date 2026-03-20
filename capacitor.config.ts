import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.pokke.app',
  appName: 'Pokke',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  ios: {
    scheme: 'Pokke',
    contentInset: 'automatic',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: '#0D0F14',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0D0F14',
    },
  },
};

export default config;
