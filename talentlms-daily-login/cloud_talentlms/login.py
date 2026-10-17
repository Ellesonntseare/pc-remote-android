"""Attempt browser sign-in, then verify the TalentLMS My Training page.

Use only GitHub Actions Secrets for credentials. Never save passwords,
session cookies, screenshots or private course information to GitHub.
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

HOST = 'intersect-alfharon.talentlms.com'
TARGET = 'https://intersect-alfharon.talentlms.com/plus/my/training'
LOGIN = 'https://intersect-alfharon.talentlms.com/plus/login?redirect=%2Fmy%2Ftraining'
OUTPUT = Path(__file__).with_name('result.json')


class LoginError(Exception):
    def __init__(self, code: str, reason: str):
        super().__init__(reason)
        self.code = code
        self.reason = reason


def safe_training_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme == 'https' and parsed.hostname == HOST and (
        parsed.path.rstrip('/') == '/plus/my/training' or
        parsed.path.startswith('/plus/my/training/')
    )


def first_visible(page, css_selectors):
    for selector in css_selectors:
        locator = page.locator(selector)
        for i in range(min(locator.count(), 12)):
            item = locator.nth(i)
            if item.is_visible() and item.is_enabled():
                return item
    return None


def page_training_verified(page) -> bool:
    if not safe_training_url(page.url):
        return False
    try:
        if first_visible(page, ['input[type="password"]']):
            return False
        body = page.locator('body').inner_text(timeout=3000).lower()
        if not body.strip() or 'you need to enable javascript' in body:
            return False
        # Do not treat a matching URL alone as a successful login.
        return bool(re.search(r'\b(my training|my courses|assigned courses|learning plan|course catalog|courses|training)\b', body))
    except Exception:
        return False


def wait_until_verified(page, wait_seconds: int = 18) -> bool:
    until = time.monotonic() + wait_seconds
    while time.monotonic() < until:
        if page_training_verified(page):
            return True
        time.sleep(0.5)
    return False


def safe_page_category(page):
    """Report only a coarse page category; never include URL query, text or credentials."""
    parsed = urlparse(page.url)
    if parsed.hostname != HOST or parsed.scheme != 'https':
        return 'EXTERNAL_AUTH'
    route = parsed.path.lower().rstrip('/')
    if route == '/plus/my/training':
        return 'TRAINING'
    if '/login' in route or 'signin' in route or 'ssologin' in route:
        return 'LOGIN'
    if route.startswith('/plus/my/') or route.startswith('/my/') or route.startswith('/plus/dashboard'):
        return 'OTHER_ACCOUNT_PAGE'
    return 'OTHER_TALENTLMS_PAGE'


def authentication_signals(page):
    """Only boolean signals; never save screenshots, DOM, cookies or user data."""
    try:
        text = page.locator('body').inner_text(timeout=2500).lower()
    except Exception:
        text = ''
    invalid = any(term in text for term in (
        'incorrect username', 'incorrect password', 'wrong password',
        'invalid username or password', 'invalid credentials',
        'username or password is incorrect', 'email or password is incorrect',
        'credentials do not match', 'login failed', 'authentication failed',
    ))
    challenge = any(term in text for term in (
        'captcha', 'verification code', 'two-factor authentication',
        'authenticator app', 'check your inbox', 'security code',
        'one-time password', 'verify your identity',
    ))
    try:
        password_visible = first_visible(page, ['input[type="password"]']) is not None
    except Exception:
        password_visible = False
    return invalid, challenge, password_visible


def fail_with_diagnostics(page):
    category = safe_page_category(page)
    invalid, challenge, password_visible = authentication_signals(page)
    if invalid:
        raise LoginError('CREDENTIALS_REJECTED', 'TalentLMS displayed an incorrect-credentials message. Verify GitHub secret values.')
    if challenge:
        raise LoginError('HUMAN_VERIFICATION', 'TalentLMS requested an interactive verification step.')
    if category == 'EXTERNAL_AUTH':
        raise LoginError('EXTERNAL_AUTH_REQUIRED', 'Sign-in redirected to an external authentication service. The stored TalentLMS password was not sent there.')
    if category == 'LOGIN':
        raise LoginError('STILL_AT_LOGIN', 'The browser remained at the TalentLMS sign-in page after submission (password field visible: ' + ('yes' if password_visible else 'no') + '). Check username, password, or sign-in requirements.')
    if category == 'TRAINING':
        raise LoginError('TRAINING_PAGE_UNRECOGNIZED', 'The browser reached the correct My Training URL but the expected authenticated course interface was not recognized.')
    raise LoginError('REDIRECT_NOT_VERIFIED', 'The browser ended at ' + category + ' instead of a verified My Training page. Login may have succeeded on a different route or further steps may be needed.')


def find_credentials_fields(page):
    username = first_visible(page, [
        'input[autocomplete="username"]', 'input[type="email"]',
        'input[name="username" i]', 'input[name="email" i]',
        'input[id*="user" i]', 'input[placeholder*="email" i]',
        'input[placeholder*="user" i]', 'input[type="text"]',
    ])
    password = first_visible(page, ['input[type="password"]'])
    return username, password


def submit(page, password):
    button = first_visible(page, [
        'button[type="submit"]', 'input[type="submit"]',
        'button:has-text("Log in")', 'button:has-text("Login")',
        'button:has-text("Sign in")',
    ])
    if button is not None:
        button.click(timeout=10000)
    else:
        password.press('Enter')


def attempt_login(username: str, password: str) -> None:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=['--no-sandbox'])
        context = browser.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=False)
        try:
            context.set_default_timeout(10000)
            page = context.new_page()
            page.goto(TARGET, wait_until='domcontentloaded', timeout=45000)
            if wait_until_verified(page, 8):
                page.reload(wait_until='domcontentloaded', timeout=45000)
                if wait_until_verified(page, 12):
                    return
            if not first_visible(page, ['input[type="password"]']):
                page.goto(LOGIN, wait_until='domcontentloaded', timeout=45000)
                for _ in range(20):
                    if first_visible(page, ['input[type="password"]']):
                        break
                    time.sleep(0.4)
            if safe_page_category(page) == 'EXTERNAL_AUTH':
                raise LoginError('EXTERNAL_AUTH_REQUIRED', 'Login redirected to a different identity provider. Credentials were not entered into that provider.')
            username_field, password_field = find_credentials_fields(page)
            if username_field is None or password_field is None:
                raise LoginError('FORM_UNAVAILABLE', 'The portal did not show a standard username/password form (possibly SSO).')
            username_field.fill(username)
            password_field.fill(password)
            submit(page, password_field)
            deadline = time.monotonic() + 40
            while time.monotonic() < deadline:
                if page_training_verified(page):
                    page.reload(wait_until='domcontentloaded', timeout=45000)
                    if wait_until_verified(page, 12):
                        return
                category = safe_page_category(page)
                invalid, challenge, password_visible = authentication_signals(page)
                if invalid:
                    raise LoginError('CREDENTIALS_REJECTED', 'TalentLMS displayed an incorrect-credentials message. Verify the saved GitHub secrets.')
                if challenge:
                    raise LoginError('HUMAN_VERIFICATION', 'TalentLMS requested an interactive verification step.')
                if category == 'EXTERNAL_AUTH':
                    raise LoginError('EXTERNAL_AUTH_REQUIRED', 'Login redirected to a different identity provider. Cannot send saved credentials outside the configured TalentLMS domain.')
                if category == 'OTHER_ACCOUNT_PAGE' and not password_visible:
                    page.goto(TARGET, wait_until='domcontentloaded', timeout=45000)
                else:
                    time.sleep(1)
            fail_with_diagnostics(page)
        finally:
            context.close()
            browser.close()


def main() -> int:
    result = json.loads(OUTPUT.read_text(encoding='utf-8'))
    if not result['should_login']:
        return 0
    username = os.getenv('TALENTLMS_USERNAME', '').strip()
    password = os.getenv('TALENTLMS_PASSWORD', '')
    if not username or not password:
        result.update(status='SETUP_REQUIRED', reason='TalentLMS GitHub Actions secrets have not been configured.')
    else:
        try:
            attempt_login(username, password)
            result.update(status='SUCCESS', reason='Logged in and verified My Training after reloading the page.')
        except LoginError as error:
            result.update(status=error.code, reason=error.reason)
        except Exception:
            # Avoid raw exception messages: Playwright can include private page content.
            result.update(status='BROWSER_ERROR', reason='The browser or website encountered an unexpected error.')
    result['checked_at'] = datetime.now(ZoneInfo('Africa/Johannesburg')).isoformat(timespec='seconds')
    OUTPUT.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(f"Login check: {result['status']}. {result['reason']}")
    return 0 if result['status'] == 'SUCCESS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
