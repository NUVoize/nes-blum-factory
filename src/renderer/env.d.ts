import type { BlumApi } from '../shared/api';

declare global {
  interface Window {
    blum: BlumApi;
  }
}

export {};
