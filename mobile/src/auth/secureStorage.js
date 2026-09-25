/**
 * V-047: auth-credential storage backed by expo-secure-store.
 *
 * Previously the 4 auth keys (jwt_token, user_data, warehouse_id,
 * login_timestamp) lived in AsyncStorage, which is unencrypted SQLite on
 * Android. They are now encrypted by the device keystore. Non-auth keys
 * (api URL, UI preferences, mode flags) remain in AsyncStorage.
 *
 * Callers should use the helpers here rather than importing SecureStore
 * directly so the list of auth keys stays centralized.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { clearAllAuthFromStores } from './authStorageClear';
import { migrateAsyncStorageToSecureStore } from './authStorageMigration';

export const AUTH_STORAGE_KEYS = [
  'jwt_token',
  'user_data',
  'warehouse_id',
  'login_timestamp',
];

// SecureStore is backed by the native keychain and is unavailable in a
// browser. The installed PWA uses AsyncStorage (localStorage on web) for its
// session. Operational API responses are never persisted by the service
// worker, and logout still clears every auth key.
const webAuthStore = {
  getItemAsync: (key) => AsyncStorage.getItem(key),
  setItemAsync: (key, value) => AsyncStorage.setItem(key, value),
  deleteItemAsync: (key) => AsyncStorage.removeItem(key),
};

const authStore = Platform.OS === 'web' ? webAuthStore : SecureStore;

export async function getAuthItem(key) {
  return authStore.getItemAsync(key);
}

export async function setAuthItem(key, value) {
  return authStore.setItemAsync(key, value);
}

export async function deleteAuthItem(key) {
  try {
    await authStore.deleteItemAsync(key);
  } catch {
    // deleteItemAsync throws if the key is not set; callers treat delete as idempotent.
  }
}

export async function clearAllAuth() {
  // V-104: clearAllAuthFromStores (in authStorageClear.js) is the pure
  // form suitable for unit tests with in-memory mocks. Here we bind it
  // to the real AsyncStorage + SecureStore backends.
  return clearAllAuthFromStores(AUTH_STORAGE_KEYS, AsyncStorage, authStore);
}

export async function runAuthStorageMigration() {
  // Running the native migration against the same web storage would copy and
  // then delete the session. There is nothing to migrate in a browser.
  if (Platform.OS === 'web') return [];
  return migrateAsyncStorageToSecureStore(AUTH_STORAGE_KEYS, AsyncStorage, authStore);
}
