// ==UserScript==
// @name         restore-github-starlist
// @namespace    https://github.com/otnc/restore-github-starlist
// @version      1.0.0
// @description  Restores the "Add to list" caret button next to the Star button on GitHub repository pages in the mobile web UI. Loads GitHub's own /lists fragment and saves through the same form endpoint as the desktop menu.
// @description:ja モバイル版 GitHub のリポジトリページで、Star ボタンの横に「リストに追加」の ▽ ボタンを復活させるユーザースクリプト。
// @author       otoneko.
// @license      MIT
// @match        https://github.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  var BTN_ID = 'gh-add-to-list-btn';
  var PANEL_ID = 'gh-add-to-list-panel';
  var CARET_SVG = '<svg aria-hidden="true" height="16" viewBox="0 0 16 16" width="16" fill="currentColor" style="display:block"><path d="m4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z"></path></svg>';
  // Primer Octicons star-fill-16 path (the outline star-16 adds an inner contour;
  // the filled variant is this single subpath).
  var STAR_FILL_D = 'M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Z';
  var STAR_GOLD = '#e3b341';

  function isDark() {
    var attr = document.documentElement.getAttribute('data-color-mode');
    if (attr === 'dark') return true;
    if (attr === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function repoFromLocation() {
    var parts = location.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    var reserved = ['settings', 'notifications', 'stars', 'explore', 'search',
      'login', 'logout', 'signup', 'marketplace', 'new', 'organizations',
      'users', 'orgs', 'pulls', 'issues', 'codespaces', 'account', 'features',
      'topics', 'trending', 'collections', 'events', 'sponsors', 'about'];
    if (reserved.indexOf(parts[0]) !== -1) return null;
    return { owner: parts[0], repo: parts[1] };
  }

  // The React header renders Star as <button aria-label="Star owner/repo"> or
  // aria-label="Unstar owner/repo". Older markup used a <form action=".../star">.
  function findStarButton() {
    var byLabel = document.querySelectorAll('button[aria-label^="Star "], button[aria-label^="Unstar "]');
    if (byLabel.length) return byLabel[0];
    var form = document.querySelector('form[action$="/star"]');
    if (form) return form.querySelector('button') || form;
    var candidates = document.querySelectorAll('button, summary');
    for (var i = 0; i < candidates.length; i++) {
      var label = candidates[i].getAttribute('aria-label') || '';
      if (/^(Un)?[Ss]tar\b/.test(label)) return candidates[i];
    }
    return null;
  }

  function closePanel() {
    var panel = document.getElementById(PANEL_ID);
    if (panel) panel.remove();
    document.removeEventListener('click', onOutsideTap, true);
  }

  function onOutsideTap(e) {
    var panel = document.getElementById(PANEL_ID);
    var btn = document.getElementById(BTN_ID);
    if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) closePanel();
  }

  function el(tag, text) {
    var node = document.createElement(tag);
    if (text != null) node.textContent = text;
    return node;
  }

  function showPanel(anchorBtn, repo) {
    closePanel();
    var dark = isDark();
    var panel = el('div');
    panel.id = PANEL_ID;
    panel.style.cssText = [
      'position:fixed', 'left:12px', 'right:12px', 'z-index:99999',
      'max-height:60vh', 'overflow:auto', 'padding:8px 12px',
      'background:' + (dark ? '#161b22' : '#fff'),
      'color:' + (dark ? '#e6edf3' : '#1f2328'),
      'border:1px solid ' + (dark ? '#30363d' : '#d1d9e0'),
      'border-radius:12px', 'box-shadow:0 8px 24px rgba(1,4,9,.35)',
      'font-size:14px', '-webkit-overflow-scrolling:touch'
    ].join(';');
    var rect = anchorBtn.getBoundingClientRect();
    var top = rect.top > window.innerHeight * 0.6 ? Math.max(8, rect.top - 320) : rect.bottom + 8;
    panel.style.top = Math.min(top, window.innerHeight - 160) + 'px';
    panel.appendChild(el('div', 'Loading lists…'));
    document.body.appendChild(panel);
    document.addEventListener('click', onOutsideTap, true);
    loadLists(panel, repo);
  }

  // Parse GitHub's /{owner}/{repo}/lists fragment. Current shape:
  //   <div class="js-user-list-menu-content-root"
  //        data-url="/owner/repo/lists"
  //        data-batch-update-url="/stars/<user>/list-menu-batch"
  //        data-repository-id="...">
  //     a nameless CSRF input (data-csrf="true"), and a <form> whose hidden
  //     fields are _method, authenticity_token, repository_id, context,
  //     list_ids[], user_list_menu_dirty. Items are <button role="option"
  //     value="<listId>"> (selected state in aria-selected / aria-checked).
  //     A classic form + checkbox variant is also handled.
  function parseFragment(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var root = doc.querySelector('.js-user-list-menu-content-root') || doc;
    var form = null;
    var forms = doc.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      if ((forms[i].getAttribute('action') || '').indexOf('/lists') !== -1) { form = forms[i]; break; }
    }
    var scope = form || root;

    var hiddenPairs = [];
    var csrfPair = null;
    doc.querySelectorAll('input[type="hidden"]').forEach(function (input) {
      var pair = { name: input.name || '', value: input.value, csrf: input.getAttribute('data-csrf') === 'true' };
      hiddenPairs.push(pair);
      if (pair.csrf) csrfPair = pair;
    });

    var items = [];
    var checks = scope.querySelectorAll('input[type="checkbox"]');
    if (checks.length) {
      checks.forEach(function (input) {
        var label = input.closest('label');
        items.push({
          value: input.value, checked: input.checked,
          label: label ? label.textContent.replace(/\s+/g, ' ').trim() : String(input.value)
        });
      });
    } else {
      scope.querySelectorAll('[role="option"]').forEach(function (node) {
        var state = node.getAttribute('aria-selected') === 'true' ||
          node.getAttribute('aria-checked') === 'true' ||
          node.getAttribute('data-selected') === 'true';
        items.push({
          value: node.getAttribute('value') || node.getAttribute('data-value') || node.getAttribute('data-list-id') || '',
          checked: state,
          label: node.textContent.replace(/\s+/g, ' ').trim()
        });
      });
    }

    return {
      hiddenPairs: hiddenPairs,
      csrfPair: csrfPair,
      items: items,
      batchUrl: root.getAttribute && root.getAttribute('data-batch-update-url'),
      formAction: form && form.getAttribute('action')
    };
  }

  function loadLists(panel, repo) {
    var url = '/' + repo.owner + '/' + repo.repo + '/lists';
    fetch(url, {
      credentials: 'same-origin',
      headers: { 'Accept': 'text/html', 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.text();
    }).then(function (html) {
      renderPanel(panel, repo, parseFragment(html));
    }).catch(function (err) {
      panel.textContent = '';
      panel.appendChild(el('div', 'Could not load your lists (' + err.message + ').'));
      var link = el('a', 'Open your Stars page instead');
      link.href = 'https://github.com/stars';
      link.style.cssText = 'display:inline-block;margin-top:8px;color:#4493f8';
      panel.appendChild(link);
    });
  }

  function renderPanel(panel, repo, parsed) {
    panel.textContent = '';
    var dark = isDark();
    var items = parsed.items;

    var title = el('div', 'Add to list');
    title.style.cssText = 'font-weight:600;padding:6px 0 2px';
    panel.appendChild(title);

    if (!items.length) panel.appendChild(el('div', 'You have no lists yet.'));

    var status = el('div', '');
    status.style.cssText = 'margin-top:8px;min-height:1em;color:' + (dark ? '#9198a1' : '#59636e');

    items.forEach(function (item) {
      var row = el('label');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:9px 2px;border-top:1px solid ' + (dark ? '#30363d' : '#e6e8ea');
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = item.checked;
      input.style.cssText = 'width:20px;height:20px;flex:none';
      input.addEventListener('change', function () {
        item.checked = input.checked;
        save(repo, parsed, status);
      });
      row.appendChild(input);
      row.appendChild(el('span', item.label));
      panel.appendChild(row);
    });

    panel.appendChild(status);

    var manage = el('a', 'Manage lists on your Stars page');
    manage.href = 'https://github.com/stars';
    manage.style.cssText = 'display:inline-block;margin:6px 0;color:#4493f8';
    panel.appendChild(manage);
  }

  // mode 'form': the fragment form's own fields, token included (a faithful
  // form submission — this is what the desktop menu does). mode 'csrf-param':
  // batch endpoint with the nameless data-csrf token sent as
  // authenticity_token. mode 'csrf-header': batch endpoint with the token in
  // the X-CSRF-Token header instead.
  function buildSaveData(parsed, mode) {
    var data = new FormData();
    var csrf = parsed.csrfPair;
    parsed.hiddenPairs.forEach(function (pair) {
      if (!pair.name || pair.csrf) return;
      if (pair.name === 'list_ids[]') return; // rebuilt below
      if (mode !== 'form' && pair.name === 'authenticity_token') return;
      if (pair.name === 'user_list_menu_dirty') { data.append(pair.name, '1'); return; }
      data.append(pair.name, pair.value);
    });
    if (mode === 'csrf-param' && csrf) data.append('authenticity_token', csrf.value);
    parsed.items.forEach(function (item) {
      if (item.checked && item.value) data.append('list_ids[]', item.value);
    });
    return data;
  }

  // Adding a repo to any list stars it server-side. Mirror that in the header:
  // fill the star gold and flip the button to its Unstar state, like desktop.
  // (Removing from all lists does not unstar — verified desktop behavior — so
  // this only ever turns the star ON.)
  function syncStarUi(parsed, starCount) {
    var anyChecked = parsed.items.some(function (item) { return item.checked; });
    if (!anyChecked) return;
    var starBtn = findStarButton();
    if (!starBtn) return;
    var label = starBtn.getAttribute('aria-label') || '';
    if (/^Star /.test(label)) starBtn.setAttribute('aria-label', label.replace(/^Star /, 'Unstar '));
    var svg = starBtn.querySelector('svg');
    if (svg) {
      var path = svg.querySelector('path');
      if (path) path.setAttribute('d', STAR_FILL_D);
      svg.style.color = STAR_GOLD;
    }
    starBtn.querySelectorAll('*').forEach(function (node) {
      if (node.children.length === 0 && node.textContent.trim() === 'Star') node.textContent = 'Starred';
    });
    if (starCount) {
      var scope = starBtn.closest('div') || document;
      var link = scope.querySelector('a[href$="/stargazers"]');
      if (link && /^[\d,.kKmM]+$/.test(link.textContent.trim())) link.textContent = starCount;
    }
  }

  // Silently refresh the form tokens after a save WITHOUT re-rendering:
  // the open panel keeps its item order and the user's toggles as-is
  // (GitHub's fragment returns selected lists first, which would visibly
  // re-sort the open panel). The fresh order applies on the next open.
  function refreshTokens(parsed, repo) {
    var url = '/' + repo.owner + '/' + repo.repo + '/lists';
    fetch(url, {
      credentials: 'same-origin',
      headers: { 'Accept': 'text/html', 'X-Requested-With': 'XMLHttpRequest' }
    }).then(function (res) {
      return res.ok ? res.text() : null;
    }).then(function (html) {
      if (!html) return;
      var fresh = parseFragment(html);
      parsed.hiddenPairs = fresh.hiddenPairs;
      parsed.csrfPair = fresh.csrfPair;
      parsed.batchUrl = fresh.batchUrl;
      parsed.formAction = fresh.formAction;
    }).catch(function () { /* keep the old tokens */ });
  }

  function save(repo, parsed, status) {
    var formUrl = parsed.formAction || ('/' + repo.owner + '/' + repo.repo + '/lists');
    var attempts = [{ url: formUrl, mode: 'form' }];
    if (parsed.batchUrl) {
      attempts.push({ url: parsed.batchUrl, mode: 'csrf-param' });
      attempts.push({ url: parsed.batchUrl, mode: 'csrf-header' });
    }

    status.textContent = 'Saving…';
    var okBody = '';

    function run(idx) {
      if (idx >= attempts.length) return Promise.resolve(false);
      var a = attempts[idx];
      var headers = { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' };
      if (a.mode === 'csrf-header' && parsed.csrfPair) headers['X-CSRF-Token'] = parsed.csrfPair.value;
      return fetch(a.url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers,
        body: buildSaveData(parsed, a.mode)
      }).then(function (res) {
        return res.text().then(function (body) {
          if (res.ok) { okBody = body; return true; }
          return run(idx + 1);
        });
      }).catch(function () {
        return run(idx + 1);
      });
    }

    run(0).then(function (saved) {
      if (!saved) {
        status.textContent = 'Save failed — tap a list to try again.';
        return;
      }
      status.textContent = 'Saved ✓';
      var starCount = null;
      try {
        var json = JSON.parse(okBody);
        if (json && json.starCount) starCount = json.starCount;
      } catch (e) { /* not JSON; ignore */ }
      syncStarUi(parsed, starCount);
      refreshTokens(parsed, repo);
    });
  }

  // Make the Star button and the caret look like one desktop split button:
  // same row, joined edge, Star keeps the left radius, caret keeps the right.
  function joinWithStar(starBtn, btn) {
    var parent = starBtn.parentNode;
    if (parent && parent.nodeType === 1 && parent.children.length <= 3) {
      parent.style.display = 'flex';
      parent.style.flexDirection = 'row';
      parent.style.alignItems = 'stretch';
      parent.style.flexWrap = 'nowrap';
    }
    starBtn.style.borderTopRightRadius = '0';
    starBtn.style.borderBottomRightRadius = '0';
    starBtn.style.marginRight = '0';
    btn.style.borderTopLeftRadius = '0';
    btn.style.borderBottomLeftRadius = '0';
    btn.style.marginLeft = '0';
    btn.style.borderLeft = 'none';
  }

  function tryInit() {
    var existing = document.getElementById(BTN_ID);
    if (existing) return true;
    var repo = repoFromLocation();
    if (!repo) return false;
    var starBtn = findStarButton();
    if (!starBtn || !starBtn.parentNode) return false;

    // Clone the Star button so the look (size, colors, dark mode) matches
    // exactly, then turn the clone into the caret half of the split button.
    var btn = starBtn.cloneNode(false);
    btn.removeAttribute('id');
    btn.removeAttribute('data-testid');
    btn.removeAttribute('aria-label');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.title = 'Add to list';
    btn.setAttribute('aria-label', 'Add to list');
    btn.innerHTML = CARET_SVG;
    btn.style.paddingLeft = '6px';
    btn.style.paddingRight = '6px';
    btn.style.minWidth = '0';
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (document.getElementById(PANEL_ID)) closePanel();
      else showPanel(btn, repoFromLocation() || repo);
    });
    starBtn.parentNode.insertBefore(btn, starBtn.nextSibling);
    joinWithStar(starBtn, btn);
    return true;
  }

  // The React header re-renders and drops foreign nodes. Keep a permanent
  // observer and re-insert on loss; also re-apply the join if layout resets.
  var scheduled = false;
  function scheduleInit() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      if (!tryInit()) return;
      var btn = document.getElementById(BTN_ID);
      var starBtn = findStarButton();
      if (btn && starBtn) {
        if (btn.previousElementSibling !== starBtn && starBtn.parentNode) {
          starBtn.parentNode.insertBefore(btn, starBtn.nextSibling);
          joinWithStar(starBtn, btn);
        } else {
          var a = starBtn.getBoundingClientRect();
          var b = btn.getBoundingClientRect();
          if (Math.abs(a.top - b.top) > 4) joinWithStar(starBtn, btn);
        }
      }
    }, 300);
  }

  function boot() {
    tryInit();
    var observer = new MutationObserver(scheduleInit);
    if (document.documentElement) observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  document.addEventListener('turbo:load', tryInit);
  document.addEventListener('turbo:render', tryInit);
})();
