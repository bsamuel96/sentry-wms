import React from 'react';
import { AuthProvider } from './src/auth/AuthContext';
import { ScanSettingsProvider } from './src/context/ScanSettingsContext';
import { WorkspaceProvider } from './src/workspace/WorkspaceContext';
import AppNavigator from './src/navigation/AppNavigator';

export default function App() {
  return (
    <AuthProvider>
      <WorkspaceProvider>
        <ScanSettingsProvider>
          <AppNavigator />
        </ScanSettingsProvider>
      </WorkspaceProvider>
    </AuthProvider>
  );
}
