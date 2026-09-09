(function() {
    'use strict';

    let isOnline = navigator.onLine;
    let isBlocking = false;

    function createNetworkBlocker() {
        const overlay = document.createElement('div');
        overlay.id = 'network-blocker';
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 999999;
            background: #f8f9fa;
            display: none;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 40px 24px;
            font-family: 'Google Sans', 'Roboto', system-ui, sans-serif;
            color: #202124;
            text-align: center;
        `;

        const icon = document.createElement('div');
        icon.style.cssText = `
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: #f1f3f4;
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 24px;
        `;
        icon.innerHTML = `
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#1a73e8" stroke-width="1.5">
                <path d="M22 2L2 22" />
                <path d="M8.5 6.5C10.5 5 13 4.5 16 5.5" />
                <path d="M12 12C13.5 12.5 15 13 16 14" />
                <path d="M3 3C5 5 7 7 9 9" />
                <path d="M14 14C16 16 18 18 21 21" />
                <circle cx="12" cy="16" r="1.5" fill="#1a73e8" />
            </svg>
        `;

        const title = document.createElement('h2');
        title.textContent = 'No internet connection';
        title.style.cssText = `
            font-family: 'Google Sans', 'Roboto', system-ui, sans-serif;
            font-size: 1.5rem;
            font-weight: 500;
            margin-bottom: 8px;
            letter-spacing: -0.3px;
            color: #202124;
        `;

        const subtitle = document.createElement('p');
        subtitle.textContent = 'Please check your network settings and try again.';
        subtitle.style.cssText = `
            font-family: 'Roboto', system-ui, sans-serif;
            font-size: 0.9rem;
            color: #5f6368;
            margin-bottom: 28px;
            max-width: 320px;
            line-height: 1.6;
        `;

        const button = document.createElement('button');
        button.textContent = 'Retry';
        button.style.cssText = `
            padding: 10px 24px;
            background: #1a73e8;
            border: none;
            border-radius: 4px;
            color: #ffffff;
            font-size: 0.875rem;
            font-weight: 500;
            font-family: 'Google Sans', 'Roboto', system-ui, sans-serif;
            cursor: pointer;
            transition: background 0.2s ease, box-shadow 0.2s ease;
            letter-spacing: 0.25px;
        `;

        button.addEventListener('mouseenter', function() {
            this.style.background = '#1557b0';
            this.style.boxShadow = '0 1px 2px rgba(60,64,67,.3), 0 2px 6px 2px rgba(60,64,67,.15)';
        });

        button.addEventListener('mouseleave', function() {
            this.style.background = '#1a73e8';
            this.style.boxShadow = 'none';
        });

        button.addEventListener('click', function() {
            checkConnection(true);
        });

        overlay.appendChild(icon);
        overlay.appendChild(title);
        overlay.appendChild(subtitle);
        overlay.appendChild(button);

        document.body.appendChild(overlay);
        return overlay;
    }

    const blocker = createNetworkBlocker();

    function checkConnection(showToast) {
        if (navigator.onLine) {
            isOnline = true;
            blocker.style.display = 'none';
            isBlocking = false;
            return true;
        } else {
            isOnline = false;
            blocker.style.display = 'flex';
            isBlocking = true;
            return false;
        }
    }

    window.addEventListener('online', function() {
        checkConnection(true);
    });

    window.addEventListener('offline', function() {
        checkConnection(false);
    });

    const originalFetch = window.fetch;

    window.fetch = function(url, options) {
        if (!navigator.onLine) {
            blocker.style.display = 'flex';
            isBlocking = true;
            return Promise.reject(new Error('No internet connection'));
        }

        return originalFetch.call(this, url, options).catch(function(error) {
            if (!navigator.onLine) {
                blocker.style.display = 'flex';
                isBlocking = true;
            }
            throw error;
        });
    };

    function blockNavigation() {
        if (!navigator.onLine) {
            blocker.style.display = 'flex';
            isBlocking = true;
            return false;
        }
        return true;
    }

    document.addEventListener('DOMContentLoaded', function() {
        checkConnection(false);

        const originalPushState = history.pushState;
        history.pushState = function() {
            if (!blockNavigation()) return;
            return originalPushState.apply(this, arguments);
        };

        const originalReplaceState = history.replaceState;
        history.replaceState = function() {
            if (!blockNavigation()) return;
            return originalReplaceState.apply(this, arguments);
        };

        document.addEventListener('click', function(e) {
            const link = e.target.closest('a');
            if (link && link.href && !link.href.startsWith('javascript:')) {
                if (!blockNavigation()) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
            }
        }, true);
    });

    window.isNetworkBlocking = function() {
        return isBlocking;
    };

    window.checkNetwork = checkConnection;

    if (!navigator.onLine) {
        blocker.style.display = 'flex';
        isBlocking = true;
    }
})();
