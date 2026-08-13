(() => {
  'use strict';

  const state = {
    manifest: null,
    currentId: '',
    collapsed: {},
    query: '',
    dailyDiscoveryError: ''
  };

  const els = {
    navTree: document.getElementById('navTree'),
    document: document.getElementById('document'),
    content: document.getElementById('content'),
    search: document.getElementById('searchInput'),
    menuButton: document.getElementById('menuButton'),
    overlay: document.getElementById('sidebarOverlay'),
    topbarMeta: document.getElementById('topbarMeta')
  };

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[char]);
  }

  function normalize(value = '') {
    return String(value).trim().toLowerCase();
  }

  function getGroups() {
    return state.manifest?.groups || [];
  }

  function getAllItems() {
    return getGroups().flatMap(group =>
      group.items.map(item => ({
        ...item,
        groupKey: group.key,
        groupTitle: group.title
      }))
    );
  }

  function findItem(id) {
    return getAllItems().find(item => item.id === id) || null;
  }

  function loadCollapsedState() {
    try {
      state.collapsed = JSON.parse(localStorage.getItem('asr-collapsed') || '{}') || {};
    } catch (_) {
      state.collapsed = {};
    }
  }

  function saveCollapsedState() {
    try {
      localStorage.setItem('asr-collapsed', JSON.stringify(state.collapsed));
    } catch (_) {}
  }

  function showOnlyGroup(activeKey) {
    getGroups().forEach(group => {
      state.collapsed[group.key] = group.key !== activeKey;
    });
  }

  function renderNav() {
    const query = normalize(state.query);
    let visibleCount = 0;

    els.navTree.innerHTML = getGroups().map(group => {
      const items = group.items.filter(item => {
        if (!query) return true;

        const haystack = [
          item.title,
          item.id,
          item.keywords?.join(' ')
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return haystack.includes(query);
      });

      if (!items.length && query) return '';

      visibleCount += items.length;
      const isCollapsed = query ? false : Boolean(state.collapsed[group.key]);

      const itemHtml = items.map(item => `
        <button
          class="nav-item${item.id === state.currentId ? ' active' : ''}"
          type="button"
          data-doc-id="${escapeHtml(item.id)}"
          title="${escapeHtml(item.title)}"
        >
          <span class="nav-icon" aria-hidden="true">${escapeHtml(item.icon || '•')}</span>
          <span class="nav-label">${escapeHtml(item.title)}</span>
        </button>
      `).join('');

      const discoveryNote =
        group.key === 'daily' &&
        state.dailyDiscoveryError &&
        !query
          ? `<div class="nav-note">${escapeHtml(state.dailyDiscoveryError)}</div>`
          : '';

      return `
        <section
          class="nav-group${isCollapsed ? ' collapsed' : ''}"
          data-group="${escapeHtml(group.key)}"
        >
          <button
            class="nav-group-title"
            type="button"
            data-group-toggle="${escapeHtml(group.key)}"
            aria-expanded="${!isCollapsed}"
          >
            <span class="chevron" aria-hidden="true">▼</span>
            <span>${escapeHtml(group.title)}</span>
          </button>
          <div class="nav-items">
            ${itemHtml}
            ${discoveryNote}
          </div>
        </section>
      `;
    }).join('');

    if (!visibleCount && query) {
      els.navTree.innerHTML = `
        <div class="nav-empty">
          没有找到“${escapeHtml(state.query)}”相关内容。
        </div>
      `;
    }
  }

  function enhanceMarkdown(root) {
    root.querySelectorAll('table').forEach(table => {
      if (table.parentElement?.classList.contains('table-wrap')) return;

      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    });
  }

  function extractTitle(markdown, fallbackTitle) {
    const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
    const index = lines.findIndex(line => /^#\s+/.test(line));

    if (index === -1) {
      return { title: fallbackTitle, body: markdown };
    }

    const title = lines[index].replace(/^#\s+/, '').trim() || fallbackTitle;
    lines.splice(index, 1);

    return {
      title,
      body: lines.join('\n').replace(/^\s+/, '')
    };
  }

  function getGitHubConfig() {
    const config = state.manifest?.github || {};

    if (config.owner && config.repo) {
      return {
        owner: config.owner,
        repo: config.repo,
        branch: config.branch || 'main',
        dailyPath: config.dailyPath || 'daily'
      };
    }

    // GitHub Pages 默认域名下可自动推导 owner / repo。
    if (location.hostname.endsWith('.github.io')) {
      const owner = location.hostname.split('.')[0];
      const firstPath = location.pathname.split('/').filter(Boolean)[0];
      const repo = firstPath || `${owner}.github.io`;

      return {
        owner,
        repo,
        branch: 'main',
        dailyPath: 'daily'
      };
    }

    return null;
  }

  async function discoverDailyItems() {
    const dailyGroup = getGroups().find(group => group.key === 'daily');
    if (!dailyGroup) return;

    const config = getGitHubConfig();
    if (!config) {
      state.dailyDiscoveryError = '未配置 GitHub 仓库，历史复盘暂未自动加载。';
      return;
    }

    const apiUrl =
      `https://api.github.com/repos/${encodeURIComponent(config.owner)}` +
      `/${encodeURIComponent(config.repo)}/contents/${encodeURI(config.dailyPath)}` +
      `?ref=${encodeURIComponent(config.branch)}`;

    try {
      const response = await fetch(apiUrl, {
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json'
        }
      });

      if (!response.ok) {
        const error = new Error(`GitHub API HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }

      const entries = await response.json();
      if (!Array.isArray(entries)) {
        throw new Error('GitHub API 返回格式异常');
      }

      const dynamicItems = entries
        .filter(entry =>
          entry.type === 'file' &&
          /^\d{4}-\d{2}-\d{2}\.md$/i.test(entry.name)
        )
        .sort((a, b) => b.name.localeCompare(a.name))
        .map(entry => {
          const date = entry.name.replace(/\.md$/i, '');
          return {
            id: `daily-${date.replaceAll('-', '')}`,
            file: `${config.dailyPath}/${entry.name}`,
            downloadUrl: entry.download_url || '',
            title: date,
            icon: '📅',
            keywords: [date, '复盘', '每日复盘'],
            updated: date
          };
        });

      // index.json 只保留模板等固定项目；日期文件由 GitHub 目录自动生成。
      const fixedItems = dailyGroup.items.filter(item => !/^daily-\d{8}$/.test(item.id));
      dailyGroup.items = [...fixedItems, ...dynamicItems];
      state.dailyDiscoveryError = '';
    } catch (error) {
      console.warn('每日复盘自动发现失败：', error);

      if (error.status === 403) {
        state.dailyDiscoveryError = 'GitHub API 暂时受限，刷新后可重试。';
      } else if (error.status === 404) {
        state.dailyDiscoveryError = '未找到 daily 目录，请检查 data/index.json 中的 GitHub 配置。';
      } else {
        state.dailyDiscoveryError = '历史复盘暂未自动加载；模板和其他文档仍可正常使用。';
      }
    }
  }

  async function loadDocument(id, pushHash = false) {
    const item = findItem(id) || getAllItems()[0];
    if (!item) return;

    state.currentId = item.id;
    showOnlyGroup(item.groupKey);
    saveCollapsedState();
    renderNav();

    els.document.innerHTML = `
      <div class="loading-state">
        <span class="loading-dot"></span>
        <span>正在读取 Markdown…</span>
      </div>
    `;

    try {
      const source = item.downloadUrl || item.file;
      const response = await fetch(source, { cache: 'no-store' });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const markdown = await response.text();
      const { title, body } = extractTitle(markdown, item.title);
      const updated = item.updated || state.manifest.updated || '';
      const parser = window.marked?.parse ? window.marked.parse : window.marked;

      if (typeof parser !== 'function') {
        throw new Error('Markdown 解析器未加载');
      }

      els.document.innerHTML = `
        <header class="doc-header">
          <h1>${escapeHtml(title)}</h1>
          <div class="doc-meta">
            <span>${escapeHtml(item.groupTitle)}</span>
            ${updated ? `
              <span class="dot">·</span>
              <span>最后更新 ${escapeHtml(updated)}</span>
            ` : ''}
          </div>
        </header>
        <div class="markdown-body">${parser(body)}</div>
      `;

      enhanceMarkdown(els.document);
      els.content.scrollTop = 0;
      document.title = `${title} - A股投资研究知识库`;

      if (pushHash && location.hash !== `#${item.id}`) {
        history.pushState(null, '', `#${item.id}`);
      }
    } catch (error) {
      console.error(error);
      const fileMode = location.protocol === 'file:';

      els.document.innerHTML = `
        <div class="error-panel">
          <h2>页面内容没有成功载入</h2>
          ${fileMode ? `
            <p>
              当前是直接双击 <code>index.html</code> 的 <code>file://</code> 模式，
              浏览器会限制页面通过 <code>fetch()</code> 读取本地 Markdown。
            </p>
            <p>
              请在项目根目录运行 <code>python -m http.server 8000</code>，
              然后访问 <code>http://localhost:8000</code>；部署到 GitHub Pages 后也可正常使用。
            </p>
          ` : `
            <p>
              未能读取 <code>${escapeHtml(item.file)}</code>。
              请检查文件是否存在、路径是否正确，以及 GitHub Pages 是否已完成部署。
            </p>
          `}
        </div>
      `;
    }
  }

  function openSidebar() {
    document.body.classList.add('sidebar-open');
    els.menuButton.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    document.body.classList.remove('sidebar-open');
    els.menuButton.setAttribute('aria-expanded', 'false');
  }

  function bindEvents() {
    els.navTree.addEventListener('click', event => {
      const toggle = event.target.closest('[data-group-toggle]');

      if (toggle) {
        showOnlyGroup(toggle.dataset.groupToggle);
        saveCollapsedState();
        renderNav();
        return;
      }

      const item = event.target.closest('[data-doc-id]');
      if (!item) return;

      loadDocument(item.dataset.docId, true);

      if (window.matchMedia('(max-width: 860px)').matches) {
        closeSidebar();
      }
    });

    els.search.addEventListener('input', () => {
      state.query = els.search.value;
      renderNav();
    });

    els.menuButton.addEventListener('click', () => {
      document.body.classList.contains('sidebar-open')
        ? closeSidebar()
        : openSidebar();
    });

    els.overlay.addEventListener('click', closeSidebar);

    window.addEventListener('hashchange', () => {
      const id = location.hash.replace(/^#/, '');
      if (id && id !== state.currentId && findItem(id)) {
        loadDocument(id, false);
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 860) closeSidebar();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeSidebar();

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        els.search.focus();

        if (window.matchMedia('(max-width: 860px)').matches) {
          openSidebar();
        }
      }
    });
  }

  async function init() {
    loadCollapsedState();
    bindEvents();

    try {
      const response = await fetch('data/index.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      state.manifest = await response.json();
      await discoverDailyItems();

      els.topbarMeta.textContent =
        `个人长期积累 · Markdown 驱动 · v${state.manifest.version || '1.1.0'}`;

      const requested = location.hash.replace(/^#/, '');
      const initialId = findItem(requested)
        ? requested
        : (state.manifest.default || getAllItems()[0]?.id);

      await loadDocument(initialId, Boolean(!requested && initialId));
    } catch (error) {
      console.error(error);
      const fileMode = location.protocol === 'file:';

      els.document.innerHTML = `
        <div class="error-panel">
          <h2>知识库索引没有成功载入</h2>
          ${fileMode ? `
            <p>
              当前是 <code>file://</code> 模式。由于页面使用 <code>fetch()</code> 读取 Markdown，
              请在项目根目录运行 <code>python -m http.server 8000</code>，
              再访问 <code>http://localhost:8000</code>。
            </p>
          ` : `
            <p>
              请检查 <code>data/index.json</code> 是否存在且 JSON 格式正确。
            </p>
          `}
        </div>
      `;
    }
  }

  init();
})();
