import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withHashLocation } from '@angular/router';
import { APP_INITIALIZER, provideZoneChangeDetection } from '@angular/core';
import { App } from './report-app';
import { routes } from './routes';
import { API_BASE_URL, UAC_BASE_URL, Auth, apiToken } from './auth';
import { loadRuntimeConfig } from './config';

loadRuntimeConfig().then(config => bootstrapApplication(App, {
  providers: [
    provideZoneChangeDetection(),
    { provide: API_BASE_URL, useValue: config.apiBaseUrl },
    { provide: UAC_BASE_URL, useValue: config.uacBaseUrl },
    provideHttpClient(withInterceptors([apiToken])),
    provideRouter(routes, withHashLocation()),
    { provide: APP_INITIALIZER, useFactory: (auth: Auth) => () => auth.initialize(), deps: [Auth], multi: true }
  ]
})).catch(error => {
  console.error('Runtime configuration or startup failed', error);
  const message = document.createElement('div');
  message.className = 'center-card';
  message.setAttribute('role', 'alert');
  message.textContent = `週報無法啟動：${error instanceof Error ? error.message : '設定載入失敗'}`;
  document.body.replaceChildren(message);
});
