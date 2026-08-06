(() => {
  'use strict';

  const state = {
    manifest: null,
    currentId: '',
    collapsed: {},
    query: ''
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
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function normalize(value = '') {
    return String(value).trim().toLowerCase();
  }

  function getAllItems() {
    if (!state.manifest) return [];
    return state.manifest.groups.flatMap(group =>
      group.items.map(item => ({ ...item, groupKey: group.key, groupTitle: group.title }))
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
    try { localStorage.setItem('asr-collapsed', JSON.stringify(state.collapsed)); } catch (_) {}
  }

  function renderNav() {
    const query = normalize(state.query);
    const groups = state.manifest?.groups || [];
    let visibleCount = 0;

    els.navTree.innerHTML = groups.map(group => {
      const items = group.items.filter(item => {
        if (!query) return true;
        const haystack = [item.title, item.id, item.keywords?.join(' ')].filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(query);
      });

      if (!items.length && query) return '';
      visibleCount += items.length;

      const isCollapsed = query ? false : Boolean(state.collapsed[group.key]);
      const itemHtml = items.map(item => `
        <button class="nav-item${item.id === state.currentId ? ' active' : ''}"
                type="button"
                data-doc-id="${escapeHtml(item.id)}"
                title="${escapeHtml(item.title)}">
          <span class="nav-icon" aria-hidden="true">${escapeHtml(item.icon || '•')}</span>
          <span class="nav-label">${escapeHtml(item.title)}</span>
        </button>
      `).join('');

      return `
        <section class="nav-group${isCollapsed ? ' collapsed' : ''}" data-group="${escapeHtml(group.key)}">
          <button class="nav-group-title" type="button" data-group-toggle="${escapeHtml(group.key)}" aria-expanded="${!isCollapsed}">
            <span class="chevron" aria-hidden="true">▼</span>
            <span>${escapeHtml(group.title)}</span>
          </button>
          <div class="nav-items">${itemHtml}</div>
        </section>
      `;
    }).join('');

    if (!visibleCount && query) {
      els.navTree.innerHTML = `<div class="nav-empty">没有找到“${escapeHtml(state.query)}”相关内容。</div>`;
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
    if (index === -1) return { title: fallbackTitle, body: markdown };
    const title = lines[index].replace(/^#\s+/, '').trim() || fallbackTitle;
    lines.splice(index, 1);
    return { title, body: lines.join('\n').replace(/^\s+/, '') };
  }

  async function loadDocument(id, pushHash = false) {
    const item = findItem(id) || getAllItems()[0];
    if (!item) return;

    state.currentId = item.id;
    state.collapsed[item.groupKey] = false;
    saveCollapsedState();
    renderNav();
    els.document.innerHTML = `<div class="loading-state"><span class="loading-dot"></span><span>正在读取 Markdown…</span></div>`;

    try {
      const response = await fetch(encodeURI(item.file), { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const markdown = await response.text();
      const { title, body } = extractTitle(markdown, item.title);
      const updated = item.updated || state.manifest.updated || '';

      const parser = window.marked?.parse ? window.marked.parse : window.marked;
      if (typeof parser !== 'function') throw new Error('Markdown 解析器未加载');

      els.document.innerHTML = `
        <header class="doc-header">
          <h1>${escapeHtml(title)}</h1>
          <div class="doc-meta">
            <span>${escapeHtml(item.groupTitle)}</span>
            ${updated ? `<span class="dot">·</span><span>最后更新 ${escapeHtml(updated)}</span>` : ''}
          </div>
        </header>
        <div class="markdown-body">${parser(body)}</div>
      `;
      enhanceMarkdown(els.document);
      els.content.scrollTop = 0;
      document.title = `${title} - A股投资研究知识库`;

      if (pushHash && location.hash !== `#${item.id}`) history.pushState(null, '', `#${item.id}`);
    } catch (error) {
      console.error(error);
      const fileMode = location.protocol === 'file:';
      els.document.innerHTML = `
        <div class="error-panel">
          <h2>页面内容没有成功载入</h2>
          ${fileMode
            ? '<p>这套页面是真正从 <code>data/index.json</code> 和 Markdown 文件读取内容，浏览器直接双击 <code>index.html</code> 时会阻止本地文件请求。</p><p>请双击根目录的 <code>run-preview.bat</code>，或通过 GitHub Pages / 本地 Web 服务器预览。</p>'
            : `<p>未能读取 <code>${escapeHtml(item.file)}</code>。请检查文件路径和服务器配置。</p>`}
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
        const key = toggle.dataset.groupToggle;
        state.collapsed[key] = !state.collapsed[key];
        saveCollapsedState();
        renderNav();
        return;
      }

      const item = event.target.closest('[data-doc-id]');
      if (item) {
        loadDocument(item.dataset.docId, true);
        if (window.matchMedia('(max-width: 860px)').matches) closeSidebar();
      }
    });

    els.search.addEventListener('input', () => {
      state.query = els.search.value;
      renderNav();
    });

    els.menuButton.addEventListener('click', () => {
      document.body.classList.contains('sidebar-open') ? closeSidebar() : openSidebar();
    });
    els.overlay.addEventListener('click', closeSidebar);

    window.addEventListener('hashchange', () => {
      const id = location.hash.replace(/^#/, '');
      if (id && id !== state.currentId && findItem(id)) loadDocument(id, false);
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 860) closeSidebar();
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeSidebar();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        els.search.focus();
        if (window.matchMedia('(max-width: 860px)').matches) openSidebar();
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
      els.topbarMeta.textContent = `个人长期积累 · Markdown 驱动 · v${state.manifest.version || '0.4.0'}`;

      const requested = location.hash.replace(/^#/, '');
      const initialId = findItem(requested) ? requested : (state.manifest.default || getAllItems()[0]?.id);
      await loadDocument(initialId, Boolean(!requested && initialId));
    } catch (error) {
      console.error(error);
      const fileMode = location.protocol === 'file:';
      els.document.innerHTML = `
        <div class="error-panel">
          <h2>知识库索引没有成功载入</h2>
          ${fileMode
            ? '<p>当前是直接双击 HTML 的 <code>file://</code> 模式。为了保持“Markdown 真正驱动”，页面需要通过本地 Web 服务读取文件。</p><p>请双击根目录 <code>run-preview.bat</code>，浏览器会自动打开预览页面。</p>'
            : '<p>请检查 <code>data/index.json</code> 是否存在、JSON 格式是否正确。</p>'}
        </div>
      `;
    }
  }

  init();
})();
