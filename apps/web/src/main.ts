import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withHashLocation } from '@angular/router';
import { APP_INITIALIZER, provideZoneChangeDetection } from '@angular/core';
import { App, routes } from './report-app';
import { API_BASE_URL, Auth, apiToken } from './auth';

const apiBaseUrl = document.querySelector<HTMLMetaElement>('meta[name="weekly-report-api-base-url"]')?.content ?? '';

bootstrapApplication(App, {
  providers: [
    provideZoneChangeDetection(),
    { provide: API_BASE_URL, useValue: apiBaseUrl },
    provideHttpClient(withInterceptors([apiToken])),
    provideRouter(routes, withHashLocation()),
    { provide: APP_INITIALIZER, useFactory: (auth: Auth) => () => auth.initialize(), deps: [Auth], multi: true }
  ]
}).catch(console.error);
