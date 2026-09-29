import { inject, Injectable, InjectionToken } from '@angular/core';
import { HttpClient, HttpInterceptorFn } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';

const uac = 'http://tncimweb1.cminl.oa/uacapi/adAuth';
const tokenKey = 'CIM_TK';
const refreshKey = 'CIM_RTK';

export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL');

export function apiUrl(baseUrl: string, path: string): string {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  return normalizedBaseUrl ? `${normalizedBaseUrl}/${path.replace(/^\/+/, '')}` : path;
}

@Injectable({ providedIn: 'root' })
export class Auth {
  private http = inject(HttpClient);
  token() { return sessionStorage.getItem(tokenKey); }

  async initialize() {
    const url = new URL(location.href);
    const certificateKey = url.searchParams.get('CertificateKey');
    try {
      if (certificateKey) {
        const result = await firstValueFrom(this.http.post<{ token: string; refreshToken: string }>(`${uac}/VerifyCert`, { CertificateKey: certificateKey }));
        this.save(result);
        url.searchParams.delete('CertificateKey');
        history.replaceState({}, '', url.toString());
        const pending = sessionStorage.getItem('reportReturnPath');
        sessionStorage.removeItem('reportReturnPath');
        if (pending) history.replaceState({}, '', `${url.pathname}${url.search}#${pending}`);
      } else if (!this.token() && sessionStorage.getItem(refreshKey)) {
        const result = await firstValueFrom(this.http.post<{ token: string; refreshToken: string }>(`${uac}/RefreshToken`, { refreshToken: sessionStorage.getItem(refreshKey) }));
        this.save(result);
      }
    } catch { this.clear(); }
  }

  async enter(path: string) {
    sessionStorage.setItem('reportReturnPath', path);
    const urls = await firstValueFrom(this.http.get<{ loginPage: string }>(`${uac}/SsoUrl`));
    const returnUrl = new URL(location.href);
    returnUrl.searchParams.delete('CertificateKey');
    returnUrl.hash = '';
    location.assign(`${urls.loginPage}?url=${encodeURIComponent(returnUrl.toString())}`);
  }

  clear() { sessionStorage.removeItem(tokenKey); sessionStorage.removeItem(refreshKey); }
  private save(user: { token: string; refreshToken: string }) {
    sessionStorage.setItem(tokenKey, user.token);
    sessionStorage.setItem(refreshKey, user.refreshToken);
  }
}

export const apiToken: HttpInterceptorFn = (request, next) => {
  const baseUrl = inject(API_BASE_URL);
  const token = inject(Auth).token();
  const requestUrl = request.url.startsWith('/api/') ? apiUrl(baseUrl, request.url) : request.url;
  const isApiRequest = request.url.startsWith('/api/') || requestUrl.startsWith(`${baseUrl.replace(/\/+$/, '')}/api/`);
  return next(isApiRequest ? request.clone({ url: requestUrl, setHeaders: token ? { Authorization: `Bearer ${token}` } : {} }) : request);
};

type SessionUser = { role: string; readerAccess: boolean };

async function signedInUser(auth: Auth, http: HttpClient, baseUrl: string, state: { url: string }): Promise<SessionUser | null> {
  if (!auth.token()) { await auth.enter(state.url); return null; }
  try {
    return await firstValueFrom(http.get<SessionUser>(apiUrl(baseUrl, '/api/me')));
  } catch (error: any) {
    if (error.status === 401) { auth.clear(); await auth.enter(state.url); }
    return null;
  }
}

export const editorGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(Auth);
  const http = inject(HttpClient);
  const baseUrl = inject(API_BASE_URL);
  const router = inject(Router);
  const me = await signedInUser(auth, http, baseUrl, state);
  return me ? (me.role === 'Guy' || me.role === 'Head' ? true : router.parseUrl('/forbidden')) : auth.token() ? router.parseUrl('/forbidden') : false;
};

export const readerGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(Auth);
  const http = inject(HttpClient);
  const baseUrl = inject(API_BASE_URL);
  const router = inject(Router);
  const me = await signedInUser(auth, http, baseUrl, state);
  return me ? (me.role === 'Guy' || me.readerAccess ? true : router.parseUrl('/forbidden')) : auth.token() ? router.parseUrl('/forbidden') : false;
};

export const entryGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(Auth);
  const http = inject(HttpClient);
  const baseUrl = inject(API_BASE_URL);
  const router = inject(Router);
  const me = await signedInUser(auth, http, baseUrl, state);
  if (!me) return auth.token() ? router.parseUrl('/forbidden') : false;
  if (me.role === 'Reader') return router.parseUrl('/reader');
  return me.role === 'Guy' || me.role === 'Head' ? true : router.parseUrl('/forbidden');
};
