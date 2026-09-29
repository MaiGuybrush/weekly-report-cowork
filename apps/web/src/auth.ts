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
  token() { return localStorage.getItem(tokenKey); }

  async initialize() {
    const url = new URL(location.href);
    const hashQueryIndex = url.hash.indexOf('?');
    const hashPath = hashQueryIndex < 0 ? url.hash.slice(1) : url.hash.slice(1, hashQueryIndex);
    const hashParams = new URLSearchParams(hashQueryIndex < 0 ? '' : url.hash.slice(hashQueryIndex + 1));
    const certificateKey = url.searchParams.get('CertificateKey') || hashParams.get('CertificateKey');
    if (certificateKey) {
      url.searchParams.delete('CertificateKey');
      hashParams.delete('CertificateKey');
      url.hash = hashPath + (hashParams.size ? `?${hashParams}` : '');
      history.replaceState(history.state, '', url.toString());
      this.clear();
    }
    const pendingPath = sessionStorage.getItem('reportReturnPath') || (url.hash.startsWith('#/') ? url.hash.slice(1) : '/');

    try {
      if (certificateKey) {
        const result = await firstValueFrom(this.http.post<{ token: string; refreshToken: string }>(`${uac}/VerifyCert`, { CertificateKey: certificateKey }));
        this.save(result);
        this.restoreReturnPath(url);
      } else {
        const result = await firstValueFrom(this.http.post<{ token: string; refreshToken: string }>(`${uac}/RefreshToken`, { refreshToken: localStorage.getItem(refreshKey) }));
        this.save(result);
        this.restoreReturnPath(url);
      }
    } catch (error) {
      console.error('UAC initialization failed', error);
      this.clear();
      try { await this.enter(pendingPath); }
      catch (redirectError) { console.error('UAC SSO redirect failed', redirectError); }
    }
  }

  async enter(path: string) {
    sessionStorage.setItem('reportReturnPath', path);
    const urls = await firstValueFrom(this.http.get<{ loginPage: string }>(`${uac}/SsoUrl`));
    const returnUrl = new URL(location.href);
    returnUrl.searchParams.delete('CertificateKey');
    returnUrl.hash = '';
    location.assign(`${urls.loginPage}?url=${encodeURIComponent(returnUrl.toString())}`);
  }

  clear() { localStorage.removeItem(tokenKey); localStorage.removeItem(refreshKey); }
  private save(user: { token: string; refreshToken: string }) {
    if (!user?.token || !user.refreshToken) throw new Error('UAC returned incomplete login information');
    localStorage.setItem(tokenKey, user.token);
    localStorage.setItem(refreshKey, user.refreshToken);
  }

  private restoreReturnPath(url: URL) {
    const pending = sessionStorage.getItem('reportReturnPath');
    if (!pending) return;
    sessionStorage.removeItem('reportReturnPath');
    url.hash = pending;
    history.replaceState(history.state, '', url.toString());
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
